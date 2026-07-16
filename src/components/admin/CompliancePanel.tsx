"use client";

/**
 * CompliancePanel — the defense-record view: provider health dots, national
 * DNC freshness (stale ⇒ cold dialing blocked) + add-to-DNC input, the alert
 * center with ACK buttons, the recent call log with consent-tier snapshots
 * and disclosure verification, revocations, email suppressions, and the
 * append-only audit tail. There is deliberately no way to REMOVE an internal
 * DNC entry from here (spec D12).
 */

import { useCallback, useEffect, useState } from "react";
import {
  BODY,
  CARD_BORDER,
  GREEN,
  INK,
  MONO,
  PANEL_CSS,
  RED,
  SEVERITY_COLORS,
  badgeStyle,
  btnGhost,
  btnPrimary,
  cardStyle,
  fetchJson,
  fmtDateTime,
  inputStyle,
  kickerStyle,
  postJson,
  relativeTime,
  shortId,
} from "./panel-shared";

type Row = Record<string, unknown>;

const s = (v: unknown): string => (v == null ? "" : String(v));

interface Flag {
  channel: string;
  enabled: boolean;
}

interface Alert {
  id: number;
  at: string;
  severity: string;
  kind: string;
  message: string;
  acknowledged_at: string | null;
}

interface CallRow {
  id: string;
  lead_id: string;
  business_name: string;
  direction: string;
  mode: string;
  purpose: string | null;
  status: string;
  outcome: string | null;
  consent_tier_snapshot: string | null;
  line_type_snapshot: string | null;
  dnc_exception_basis: string | null;
  disclosure_played: boolean;
  disclosure_verified: boolean;
  duration_s: number | null;
  cost_cents: number | null;
  created_at: string;
}

interface ComplianceData {
  configured: boolean;
  flags?: Flag[];
  alerts?: Alert[];
  dnc?: {
    syncedAt: string | null;
    ageDays: number | null;
    fresh: boolean;
    internalCount: number;
    nationalCount: number;
  };
  suppressions?: Row[];
  revocations?: Row[];
  recentCalls?: CallRow[];
  providerHealth?: Record<string, boolean>;
  auditTail?: Row[];
}

const PROVIDERS: { key: string; label: string }[] = [
  { key: "db", label: "DATABASE" },
  { key: "vapi", label: "VAPI" },
  { key: "twilio", label: "TWILIO" },
  { key: "resend", label: "RESEND" },
  { key: "posthog", label: "POSTHOG" },
  { key: "dncSan", label: "DNC SAN" },
];

function truncate(str: string, n: number): string {
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        ...cardStyle,
        borderColor: "rgba(224,138,134,.5)",
        background: "#fdf3f2",
        marginBottom: 16,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: "0.14em",
            color: "#b04a45",
            marginBottom: 4,
          }}
        >
          ERROR
        </div>
        <div style={{ fontSize: 13, color: BODY, wordBreak: "break-word" }}>{message}</div>
      </div>
      <button onClick={onRetry} style={{ ...btnPrimary, flexShrink: 0 }}>
        RETRY
      </button>
    </div>
  );
}

function NotConfiguredCard() {
  return (
    <div style={{ ...cardStyle, maxWidth: 720 }}>
      <div style={kickerStyle}>Not configured</div>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: BODY }}>
        Automation database not configured — set the TURSO_DATABASE_URL /
        TURSO_AUTH_TOKEN vars (see .env.example), then reload this page.
      </div>
    </div>
  );
}

export default function CompliancePanel() {
  const [data, setData] = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dncPhone, setDncPhone] = useState("");
  const [dncMsg, setDncMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchJson<ComplianceData>("/api/admin/compliance"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load compliance data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred a tick — no synchronous setState inside the effect body.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function ack(id: number) {
    setBusy(`ack:${id}`);
    try {
      await postJson(`/api/admin/alerts/${id}/ack`, {});
      setData((prev) =>
        prev
          ? { ...prev, alerts: (prev.alerts ?? []).filter((a) => a.id !== id) }
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Alert ack failed");
    } finally {
      setBusy(null);
    }
  }

  async function addDnc() {
    if (!dncPhone.trim()) return;
    setBusy("dnc");
    setDncMsg(null);
    try {
      const res = await postJson<{ ok: boolean; phone: string }>("/api/admin/dnc", {
        phone: dncPhone.trim(),
      });
      setDncMsg({ text: `${res.phone} added — revocation pipeline ran.`, err: false });
      setDncPhone("");
      load();
    } catch (err) {
      setDncMsg({ text: err instanceof Error ? err.message : "DNC add failed", err: true });
    } finally {
      setBusy(null);
    }
  }

  if (data && data.configured === false) return <NotConfiguredCard />;

  const health = data?.providerHealth ?? {};
  const dnc = data?.dnc;
  const alerts = data?.alerts ?? [];
  const calls = data?.recentCalls ?? [];
  const revocations = data?.revocations ?? [];
  const suppressions = data?.suppressions ?? [];
  const audit = data?.auditTail ?? [];

  const empty = (label: string) => (
    <div style={{ fontFamily: MONO, fontSize: 12, color: BODY }}>{label}</div>
  );

  return (
    <>
      <style>{PANEL_CSS}</style>

      {error && <ErrorCard message={error} onRetry={load} />}

      <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity .2s" }}>
        <div className="vw-admin-grid">
          {/* Provider health */}
          <div style={cardStyle}>
            <div style={kickerStyle}>Provider health</div>
            {PROVIDERS.map((p) => {
              const ok = Boolean(health[p.key]);
              return (
                <div
                  key={p.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "5px 0",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: ok ? GREEN : "rgba(65,76,87,.35)",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      letterSpacing: "0.1em",
                      color: INK,
                      width: 90,
                    }}
                  >
                    {p.label}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: ok ? GREEN : BODY }}>
                    {ok ? "configured" : "no-op"}
                  </span>
                </div>
              );
            })}
          </div>

          {/* National DNC */}
          <div style={cardStyle}>
            <div style={kickerStyle}>National DNC</div>
            {dnc ? (
              <>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 12,
                    letterSpacing: "0.06em",
                    color: dnc.fresh ? GREEN : RED,
                    marginBottom: 8,
                  }}
                >
                  {dnc.fresh
                    ? `FRESH — synced ${Math.floor(dnc.ageDays ?? 0)}d ago`
                    : "STALE — cold dialing blocked"}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: BODY, marginBottom: 12 }}>
                  {dnc.syncedAt ? `last sync ${fmtDateTime(dnc.syncedAt)}` : "never synced"} ·
                  internal {dnc.internalCount.toLocaleString()} · national{" "}
                  {dnc.nationalCount.toLocaleString()}
                </div>
              </>
            ) : (
              empty("Loading…")
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                value={dncPhone}
                onChange={(e) => setDncPhone(e.target.value)}
                placeholder="(555) 201-3344"
                style={{ ...inputStyle, width: 150 }}
              />
              <button
                onClick={addDnc}
                disabled={busy === "dnc" || !dncPhone.trim()}
                style={{
                  ...btnPrimary,
                  opacity: busy === "dnc" || !dncPhone.trim() ? 0.5 : 1,
                }}
              >
                ADD TO DNC
              </button>
            </div>
            {dncMsg && (
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  color: dncMsg.err ? RED : GREEN,
                  marginTop: 8,
                }}
              >
                {dncMsg.text}
              </div>
            )}
            <div
              style={{
                fontFamily: MONO,
                fontSize: 10,
                color: BODY,
                marginTop: 12,
                borderTop: CARD_BORDER,
                paddingTop: 10,
                lineHeight: 1.7,
              }}
            >
              Internal DNC entries cannot be removed from this panel — by design.
            </div>
          </div>
        </div>

        {/* Alerts */}
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <div style={kickerStyle}>Alerts — unacknowledged</div>
          {alerts.length === 0 ? (
            empty("No unacknowledged alerts.")
          ) : (
            alerts.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "7px 0",
                  borderBottom: "1px solid rgba(26,33,41,.06)",
                }}
              >
                <div style={{ fontFamily: MONO, fontSize: 12, color: INK, wordBreak: "break-word" }}>
                  <span style={badgeStyle(SEVERITY_COLORS[a.severity] ?? BODY)}>
                    {a.severity}
                  </span>{" "}
                  {a.kind} · {a.message}{" "}
                  <span style={{ color: BODY }}>({relativeTime(a.at)})</span>
                </div>
                <button
                  onClick={() => ack(a.id)}
                  disabled={busy === `ack:${a.id}`}
                  style={{ ...btnGhost, flexShrink: 0 }}
                >
                  ACK
                </button>
              </div>
            ))
          )}
        </div>

        {/* Call log */}
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <div style={kickerStyle}>Call log — recent 50</div>
          {calls.length === 0 ? (
            empty("No calls recorded.")
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="vw-admin-table" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th>At</th>
                    <th>Business</th>
                    <th>Mode</th>
                    <th>Purpose</th>
                    <th>Outcome</th>
                    <th>Consent</th>
                    <th>Disclosure</th>
                    <th style={{ textAlign: "right" }}>Dur</th>
                    <th style={{ textAlign: "right" }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((c) => {
                    const outboundAi = c.direction === "outbound" && c.mode === "ai";
                    return (
                      <tr key={c.id}>
                        <td
                          style={{ fontFamily: MONO, fontSize: 11, whiteSpace: "nowrap" }}
                          title={c.created_at}
                        >
                          {fmtDateTime(c.created_at)}
                        </td>
                        <td style={{ fontWeight: 500 }}>
                          {c.business_name || shortId(c.lead_id)}
                        </td>
                        <td style={{ fontFamily: MONO, fontSize: 11 }}>
                          {c.mode}
                          {c.direction === "inbound" ? " (in)" : ""}
                        </td>
                        <td style={{ fontFamily: MONO, fontSize: 11 }}>{c.purpose ?? "—"}</td>
                        <td style={{ fontFamily: MONO, fontSize: 11 }}>
                          {c.outcome ?? c.status}
                        </td>
                        <td style={{ fontFamily: MONO, fontSize: 11 }}>
                          {c.consent_tier_snapshot ?? "—"}
                          {c.dnc_exception_basis ? ` (${c.dnc_exception_basis})` : ""}
                        </td>
                        <td style={{ fontFamily: MONO, fontSize: 12 }}>
                          {outboundAi ? (
                            c.disclosure_verified ? (
                              <span style={{ color: GREEN }}>✓</span>
                            ) : (
                              <span style={{ color: RED }}>✗</span>
                            )
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={{ fontFamily: MONO, fontSize: 11, textAlign: "right" }}>
                          {c.duration_s != null ? `${c.duration_s}s` : "—"}
                        </td>
                        <td style={{ fontFamily: MONO, fontSize: 11, textAlign: "right" }}>
                          {c.cost_cents != null
                            ? `$${(c.cost_cents / 100).toFixed(2)}`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Revocations + suppressions */}
        <div className="vw-admin-grid" style={{ marginTop: 16 }}>
          <div style={cardStyle}>
            <div style={kickerStyle}>Revocations</div>
            {revocations.length === 0 ? (
              empty("No revocations recorded.")
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="vw-admin-table">
                  <thead>
                    <tr>
                      <th>At</th>
                      <th>Channel</th>
                      <th>Source</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revocations.map((r) => (
                      <tr key={s(r.id)}>
                        <td
                          style={{ fontFamily: MONO, fontSize: 11, whiteSpace: "nowrap" }}
                          title={s(r.revoked_at)}
                        >
                          {fmtDateTime(s(r.revoked_at))}
                        </td>
                        <td style={{ fontFamily: MONO, fontSize: 11 }}>{s(r.channel)}</td>
                        <td style={{ fontFamily: MONO, fontSize: 11 }}>{s(r.source)}</td>
                        <td
                          style={{ fontFamily: MONO, fontSize: 11, color: BODY }}
                          title={s(r.evidence)}
                        >
                          {truncate(s(r.evidence), 60)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={kickerStyle}>Email suppressions</div>
            {suppressions.length === 0 ? (
              empty("No suppressed addresses.")
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="vw-admin-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Reason</th>
                      <th>Source</th>
                      <th>Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppressions.map((r) => (
                      <tr key={s(r.email)}>
                        <td style={{ fontFamily: MONO, fontSize: 11, wordBreak: "break-all" }}>
                          {s(r.email)}
                        </td>
                        <td style={{ fontFamily: MONO, fontSize: 11 }}>{s(r.reason)}</td>
                        <td style={{ fontFamily: MONO, fontSize: 11 }}>{s(r.source)}</td>
                        <td
                          style={{ fontFamily: MONO, fontSize: 11, whiteSpace: "nowrap" }}
                          title={s(r.added_at)}
                        >
                          {relativeTime(s(r.added_at))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Audit tail */}
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <div style={kickerStyle}>Audit tail — recent 100</div>
          {audit.length === 0 ? (
            empty("No audit rows yet.")
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="vw-admin-table" style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th>At</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Channel</th>
                    <th>Lead</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((r) => (
                    <tr key={s(r.id)}>
                      <td
                        style={{ fontFamily: MONO, fontSize: 11, whiteSpace: "nowrap" }}
                        title={s(r.at)}
                      >
                        {fmtDateTime(s(r.at))}
                      </td>
                      <td style={{ fontFamily: MONO, fontSize: 11 }}>{s(r.actor)}</td>
                      <td style={{ fontFamily: MONO, fontSize: 11 }}>{s(r.action)}</td>
                      <td style={{ fontFamily: MONO, fontSize: 11, color: BODY }}>
                        {s(r.channel) || "—"}
                      </td>
                      <td style={{ fontFamily: MONO, fontSize: 11 }} title={s(r.lead_id)}>
                        {shortId(s(r.lead_id) || null)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
