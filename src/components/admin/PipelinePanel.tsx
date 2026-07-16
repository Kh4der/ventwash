"use client";

/**
 * PipelinePanel — the Pipeline tab: lifecycle funnel across the 13 statuses,
 * queue-depth/heartbeat stat tiles, consent breakdown, recent activity, a
 * filterable paginated lead table, and the per-lead slide-over drawer with
 * the monospace audit timeline, consent evidence, contact provenance ("where
 * did we get this") and the compliance-gated call/transition/DNC/delete
 * actions. DB rows are canonical here — never PostHog.
 */

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  BODY,
  CARD_BORDER,
  GREEN,
  HEAD,
  INK,
  LEAD_STATUS_COLORS,
  MONO,
  PANEL_CSS,
  RED,
  badgeStyle,
  btnGhost,
  btnPrimary,
  cardStyle,
  consentBadge,
  fetchJson,
  fmtDateTime,
  inputStyle,
  kickerStyle,
  postJson,
  prettify,
  relativeTime,
  shortId,
} from "./panel-shared";

type Row = Record<string, unknown>;

const s = (v: unknown): string => (v == null ? "" : String(v));

const ALL_STATUSES = [
  "discovered",
  "enriched",
  "review_queue",
  "approved_outreach",
  "contacting",
  "engaged",
  "appointment_scheduled",
  "won_pending_onboarding",
  "onboarded",
  "inspection_scheduled",
  "customer",
  "lost",
  "do_not_contact",
];

const SOURCES = [
  "osm",
  "csv_import",
  "own_website",
  "gov_open_data",
  "inbound_form",
  "inbound_call",
  "manual",
];

const CONSENTS = ["none", "express", "express_written"];
const APPROVALS = ["not_required", "pending", "approved", "rejected"];

const PAGE_SIZE = 50;

interface PipelineData {
  configured: boolean;
  funnel?: { status: string; count: number }[];
  queueDepth?: Record<string, number>;
  upcomingAppointments?: {
    id: string;
    leadBusiness: string;
    kind: string;
    status: string;
    startsAt: string;
  }[];
  recentActivity?: {
    id: number;
    leadId: string;
    business: string;
    at: string;
    type: string;
    fromStatus: string | null;
    toStatus: string | null;
    actor: string;
    meta: Record<string, unknown>;
  }[];
  consentBreakdown?: { tier: string; count: number }[];
  lastHeartbeat?: string | null;
}

interface LeadsData {
  configured: boolean;
  leads?: Row[];
  total?: number;
  page?: number;
}

interface DetailData {
  configured: boolean;
  lead?: Row;
  events?: Row[];
  calls?: Row[];
  messages?: Row[];
  contactPoints?: Row[];
  consentEvents?: Row[];
  appointments?: Row[];
  onboarding?: Row | null;
}

/* ------------------------------- local pieces ------------------------------- */

function StatTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ ...kickerStyle, marginBottom: 10 }}>{label}</div>
      <div
        style={{
          fontFamily: HEAD,
          fontWeight: 800,
          fontSize: 30,
          lineHeight: 1,
          color: color ?? INK,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function BarRow({
  label,
  count,
  max,
}: {
  label: string;
  count: number;
  max: number;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
        }}
      >
        <span
          style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.1em", color: INK }}
        >
          {label}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: BODY }}>
          {count.toLocaleString()}
        </span>
      </div>
      <div style={{ height: 8, background: "#eef3f8", borderRadius: 2, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: pct + "%",
            minWidth: count > 0 ? 3 : 0,
            background: "#3E6FA6",
            borderRadius: 2,
            transition: "width .4s ease",
          }}
        />
      </div>
    </div>
  );
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
        Automation database not configured — set{" "}
        <span style={{ fontFamily: MONO, fontSize: 12, background: "#eef3f8", padding: "1px 6px", borderRadius: 3, color: INK }}>
          TURSO_DATABASE_URL
        </span>{" "}
        /{" "}
        <span style={{ fontFamily: MONO, fontSize: 12, background: "#eef3f8", padding: "1px 6px", borderRadius: 3, color: INK }}>
          TURSO_AUTH_TOKEN
        </span>{" "}
        (see .env.example), then reload this page.
      </div>
    </div>
  );
}

function Shimmer() {
  const block = (h: number): CSSProperties => ({
    ...cardStyle,
    height: h,
    background: "linear-gradient(90deg,#ffffff 25%,#f0f5f9 50%,#ffffff 75%)",
    backgroundSize: "400% 100%",
    animation: "vwShimmer 1.4s ease infinite",
  });
  return (
    <>
      <style>{`@keyframes vwShimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}`}</style>
      <div style={block(320)} />
      <div className="vw-admin-tiles" style={{ marginTop: 16 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={block(92)} />
        ))}
      </div>
      <div style={{ ...block(280), marginTop: 16 }} />
    </>
  );
}

/* ------------------------------- detail drawer ------------------------------- */

const drawerLabel: CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: BODY,
  marginBottom: 6,
};

const drawerSection: CSSProperties = {
  borderTop: CARD_BORDER,
  paddingTop: 14,
  marginTop: 14,
};

function LeadDrawer({
  leadId,
  onClose,
  onChanged,
}: {
  leadId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [purpose, setPurpose] = useState("quote_followup");
  const [transTo, setTransTo] = useState("");
  const [bridgeConfirm, setBridgeConfirm] = useState(false);
  const [dncConfirm, setDncConfirm] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delText, setDelText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, { text: string; err: boolean }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await fetchJson<DetailData>(`/api/admin/leads/${leadId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lead");
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    // Deferred a tick — no synchronous setState inside the effect body.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const note = (key: string, text: string, err = false) =>
    setNotes((p) => ({ ...p, [key]: { text, err } }));

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setNotes((p) => ({ ...p, [key]: { text: "", err: false } }));
    try {
      await fn();
    } catch (err) {
      note(key, err instanceof Error ? err.message : "Action failed", true);
    } finally {
      setBusy(null);
    }
  }

  const lead = detail?.lead;
  const tier = s(lead?.consent_tier);
  const approval = s(lead?.approval);
  const status = s(lead?.status);
  const lineType = s(lead?.phone_line_type);
  const phone = s(lead?.phone_e164);
  const bridgeEligible =
    approval === "approved" && (lineType === "landline" || lineType === "fixedVoip");

  const queueCall = () =>
    run("call", async () => {
      const res = await postJson<{ ok: boolean; jobId: string | null; deduped: boolean }>(
        `/api/admin/leads/${leadId}/call`,
        { purpose },
      );
      note(
        "call",
        res.deduped
          ? "An identical call is already queued this hour — deduped."
          : `AI call queued (job ${shortId(res.jobId)}). The dial-time gauntlet re-runs before it rings.`,
      );
      onChanged();
    });

  const bridge = () =>
    run("bridge", async () => {
      const res = await postJson<{ ok: boolean; callAttemptId: string; simulated: boolean }>(
        `/api/admin/leads/${leadId}/bridge`,
        {},
      );
      setBridgeConfirm(false);
      note(
        "bridge",
        res.simulated
          ? "Bridge simulated — Twilio not configured (dev no-op)."
          : "Bridge dialing — your phone rings first, then connects to the lead.",
      );
      load();
      onChanged();
    });

  const markWon = () =>
    run("won", async () => {
      await postJson(`/api/admin/leads/${leadId}/transition`, {
        to: "won_pending_onboarding",
      });
      note("won", "Marked won — the onboarding invite issues from this transition.");
      load();
      onChanged();
    });

  const doTransition = () =>
    run("transition", async () => {
      if (!transTo) return;
      const res = await postJson<{ ok: boolean; from: string; to: string }>(
        `/api/admin/leads/${leadId}/transition`,
        { to: transTo },
      );
      note("transition", `${prettify(res.from)} → ${prettify(res.to)}`);
      load();
      onChanged();
    });

  const addDnc = () =>
    run("dnc", async () => {
      const res = await postJson<{ ok: boolean; phone: string }>("/api/admin/dnc", {
        phone,
      });
      setDncConfirm(false);
      note("dnc", `${res.phone} added to the internal DNC — full revocation pipeline ran.`);
      load();
      onChanged();
    });

  const del = () =>
    run("delete", async () => {
      await fetchJson(`/api/admin/leads/${leadId}`, { method: "DELETE" });
      onChanged();
      onClose();
    });

  const noteLine = (key: string) =>
    notes[key]?.text ? (
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color: notes[key].err ? RED : GREEN,
          marginTop: 6,
          wordBreak: "break-word",
        }}
      >
        {notes[key].text}
      </div>
    ) : null;

  const contactRow = (label: string, value: string, href?: string) =>
    value ? (
      <div style={{ display: "flex", gap: 10, padding: "3px 0" }}>
        <span style={{ ...drawerLabel, marginBottom: 0, width: 78, flexShrink: 0, paddingTop: 2 }}>
          {label}
        </span>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            style={{ fontFamily: MONO, fontSize: 12, color: "#3E6FA6", wordBreak: "break-all" }}
          >
            {value}
          </a>
        ) : (
          <span style={{ fontFamily: MONO, fontSize: 12, color: INK, wordBreak: "break-all" }}>
            {value}
          </span>
        )}
      </div>
    ) : null;

  const cb = consentBadge(tier);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(26,33,41,.28)",
          zIndex: 50,
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: "min(560px, 100vw)",
          height: "100vh",
          background: "#ffffff",
          boxShadow: "-12px 0 32px rgba(26,33,41,.22)",
          zIndex: 51,
          overflowY: "auto",
          padding: "20px 24px 48px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 20, color: INK }}>
            {loading && !lead ? "Loading…" : s(lead?.business_name) || "Lead"}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              fontFamily: MONO,
              fontSize: 16,
              border: "none",
              background: "none",
              color: BODY,
              cursor: "pointer",
              padding: "0 2px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div style={{ marginTop: 14 }}>
            <ErrorCard message={error} onRetry={load} />
          </div>
        )}

        {detail && detail.configured === false && (
          <div style={{ ...kickerStyle, marginTop: 14 }}>
            Automation database not configured — see .env.example
          </div>
        )}

        {lead && (
          <>
            {/* Badges */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 12,
                alignItems: "center",
              }}
            >
              <span style={badgeStyle(LEAD_STATUS_COLORS[status] ?? BODY)}>
                {prettify(status)}
              </span>
              <span style={badgeStyle(cb.color)}>{cb.label}</span>
              <span style={badgeStyle(BODY)}>APPROVAL: {prettify(approval)}</span>
              <span style={badgeStyle(BODY)}>
                LINE: {lineType ? lineType.toUpperCase() : "UNKNOWN"}
              </span>
              <span style={badgeStyle(INK)}>SCORE {Number(lead.score ?? 0)}</span>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: BODY, marginTop: 6 }}>
              {shortId(s(lead.id))} · {prettify(s(lead.discovery_source))}
              {s(lead.provenance_note) ? ` · ${s(lead.provenance_note)}` : ""} · created{" "}
              {relativeTime(s(lead.created_at))}
            </div>

            {/* Contact */}
            <div style={drawerSection}>
              <div style={drawerLabel}>Contact</div>
              {contactRow("Name", s(lead.contact_name))}
              {contactRow("Phone", phone)}
              {contactRow("Email", s(lead.email), s(lead.email) ? `mailto:${s(lead.email)}` : undefined)}
              {contactRow("Website", s(lead.website), s(lead.website) || undefined)}
              {contactRow(
                "Address",
                [s(lead.address), s(lead.city), s(lead.region), s(lead.postal)]
                  .filter(Boolean)
                  .join(", "),
              )}
              {contactRow("Timezone", s(lead.timezone))}
            </div>

            {/* Contact points — provenance */}
            <div style={drawerSection}>
              <div style={drawerLabel}>Contact points — where did we get this</div>
              {(detail?.contactPoints ?? []).length === 0 ? (
                <div style={{ fontFamily: MONO, fontSize: 11, color: BODY }}>
                  No extracted contact points.
                </div>
              ) : (
                (detail?.contactPoints ?? []).map((cp) => (
                  <div
                    key={s(cp.id)}
                    style={{ fontFamily: MONO, fontSize: 11, color: INK, padding: "3px 0" }}
                  >
                    {s(cp.kind).toUpperCase()} · {s(cp.value)} ·{" "}
                    <a
                      href={s(cp.source_url)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#3E6FA6" }}
                    >
                      source
                    </a>{" "}
                    <span style={{ color: BODY }}>({relativeTime(s(cp.extracted_at))})</span>
                  </div>
                ))
              )}
            </div>

            {/* Actions */}
            <div style={drawerSection}>
              <div style={drawerLabel}>Actions</div>

              {/* Queue AI call — consented leads only */}
              {tier !== "none" && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                      style={inputStyle}
                    >
                      <option value="quote_followup">QUOTE FOLLOWUP</option>
                      <option value="appointment_confirmation">APPT CONFIRMATION</option>
                    </select>
                    <button
                      onClick={queueCall}
                      disabled={busy === "call"}
                      style={{ ...btnPrimary, opacity: busy === "call" ? 0.6 : 1 }}
                    >
                      QUEUE AI CALL
                    </button>
                  </div>
                  {noteLine("call")}
                </div>
              )}

              {/* Bridge dial — the ONLY path to a cold phone */}
              {tier === "none" && (
                <div style={{ marginBottom: 12 }}>
                  <button
                    onClick={() => setBridgeConfirm(true)}
                    disabled={!bridgeEligible || busy === "bridge"}
                    title={
                      bridgeEligible
                        ? "Founder click-to-dial — human voice only"
                        : "Requires founder approval and a verified landline / fixed-VoIP line"
                    }
                    style={{
                      ...btnPrimary,
                      opacity: !bridgeEligible || busy === "bridge" ? 0.45 : 1,
                      cursor: bridgeEligible ? "pointer" : "not-allowed",
                    }}
                  >
                    BRIDGE DIAL
                  </button>
                  {!bridgeEligible && (
                    <div style={{ fontFamily: MONO, fontSize: 10, color: BODY, marginTop: 5 }}>
                      Cold leads can never be AI-dialed. Bridge dialing needs approval=
                      approved and line type landline/fixedVoip.
                    </div>
                  )}
                  {bridgeConfirm && (
                    <div
                      style={{
                        border: CARD_BORDER,
                        borderRadius: 6,
                        padding: 12,
                        marginTop: 8,
                        background: "#f3f8fb",
                      }}
                    >
                      <div style={{ ...drawerLabel, marginBottom: 8 }}>
                        Compliance checklist — confirm before dialing
                      </div>
                      <ul
                        style={{
                          fontFamily: MONO,
                          fontSize: 11,
                          color: INK,
                          lineHeight: 1.9,
                          margin: 0,
                          paddingLeft: 18,
                        }}
                      >
                        <li>Human call — no AI, no prerecorded audio</li>
                        <li>Landline / fixed-VoIP verified</li>
                        <li>Founder approved (logged decision)</li>
                        <li>DNC data fresh (≤31 days)</li>
                      </ul>
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button
                          onClick={bridge}
                          disabled={busy === "bridge"}
                          style={{ ...btnPrimary, opacity: busy === "bridge" ? 0.6 : 1 }}
                        >
                          PLACE BRIDGE CALL
                        </button>
                        <button onClick={() => setBridgeConfirm(false)} style={btnGhost}>
                          CANCEL
                        </button>
                      </div>
                    </div>
                  )}
                  {noteLine("bridge")}
                </div>
              )}

              {/* Mark won — issues the onboarding invite */}
              {status === "appointment_scheduled" && (
                <div style={{ marginBottom: 12 }}>
                  <button
                    onClick={markWon}
                    disabled={busy === "won"}
                    style={{ ...btnPrimary, opacity: busy === "won" ? 0.6 : 1 }}
                  >
                    MARK WON
                  </button>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: BODY, marginLeft: 8 }}>
                    → won_pending_onboarding (sends the onboarding invite)
                  </span>
                  {noteLine("won")}
                </div>
              )}

              {/* Manual transition */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={transTo}
                    onChange={(e) => setTransTo(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">MANUAL TRANSITION…</option>
                    {ALL_STATUSES.filter((v) => v !== status).map((v) => (
                      <option key={v} value={v}>
                        {prettify(v)}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={doTransition}
                    disabled={!transTo || busy === "transition"}
                    style={{
                      ...btnGhost,
                      opacity: !transTo || busy === "transition" ? 0.5 : 1,
                    }}
                  >
                    GO
                  </button>
                </div>
                {noteLine("transition")}
              </div>

              {/* Add to DNC */}
              {phone && (
                <div style={{ marginBottom: 12 }}>
                  <button onClick={() => setDncConfirm(true)} style={btnGhost}>
                    ADD TO DNC
                  </button>
                  {dncConfirm && (
                    <div
                      style={{
                        border: CARD_BORDER,
                        borderRadius: 6,
                        padding: 12,
                        marginTop: 8,
                        background: "#f3f8fb",
                      }}
                    >
                      <div style={{ fontFamily: MONO, fontSize: 11, color: INK, lineHeight: 1.7 }}>
                        Add {phone} to the internal Do-Not-Call list? This runs the full
                        revocation pipeline and cannot be undone from the admin panel.
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button
                          onClick={addDnc}
                          disabled={busy === "dnc"}
                          style={{ ...btnPrimary, opacity: busy === "dnc" ? 0.6 : 1 }}
                        >
                          CONFIRM
                        </button>
                        <button onClick={() => setDncConfirm(false)} style={btnGhost}>
                          CANCEL
                        </button>
                      </div>
                    </div>
                  )}
                  {noteLine("dnc")}
                </div>
              )}

              {/* Delete lead — privacy cascade */}
              <div>
                <button
                  onClick={() => setDelOpen((v) => !v)}
                  style={{ ...btnGhost, color: RED, borderColor: "rgba(176,74,69,.4)" }}
                >
                  DELETE LEAD
                </button>
                {delOpen && (
                  <div
                    style={{
                      border: "1px solid rgba(224,138,134,.5)",
                      borderRadius: 6,
                      padding: 12,
                      marginTop: 8,
                      background: "#fdf3f2",
                    }}
                  >
                    <div style={{ fontFamily: MONO, fontSize: 11, color: INK, lineHeight: 1.7 }}>
                      Privacy deletion: PII is nulled, identifiers are tombstoned so
                      discovery never re-creates this lead, and pending jobs are
                      cancelled. Type DELETE to confirm.
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <input
                        value={delText}
                        onChange={(e) => setDelText(e.target.value)}
                        placeholder="DELETE"
                        style={{ ...inputStyle, width: 110 }}
                      />
                      <button
                        onClick={del}
                        disabled={delText !== "DELETE" || busy === "delete"}
                        style={{
                          ...btnPrimary,
                          background: RED,
                          opacity: delText !== "DELETE" || busy === "delete" ? 0.5 : 1,
                        }}
                      >
                        DELETE FOREVER
                      </button>
                    </div>
                  </div>
                )}
                {noteLine("delete")}
              </div>
            </div>

            {/* Timeline */}
            <div style={drawerSection}>
              <div style={drawerLabel}>Timeline — newest first</div>
              {(detail?.events ?? []).length === 0 ? (
                <div style={{ fontFamily: MONO, fontSize: 11, color: BODY }}>No events.</div>
              ) : (
                (detail?.events ?? []).map((e) => (
                  <div
                    key={s(e.id)}
                    title={s(e.meta)}
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      color: INK,
                      padding: "3px 0",
                      borderBottom: "1px solid rgba(26,33,41,.05)",
                    }}
                  >
                    <span style={{ color: BODY }}>{fmtDateTime(s(e.at))}</span> · {s(e.actor)} ·{" "}
                    {s(e.type)}
                    {s(e.from_status) || s(e.to_status)
                      ? ` · ${s(e.from_status) || "∅"}→${s(e.to_status) || "∅"}`
                      : ""}
                  </div>
                ))
              )}
            </div>

            {/* Calls */}
            <div style={drawerSection}>
              <div style={drawerLabel}>Calls</div>
              {(detail?.calls ?? []).length === 0 ? (
                <div style={{ fontFamily: MONO, fontSize: 11, color: BODY }}>No calls.</div>
              ) : (
                (detail?.calls ?? []).map((c) => (
                  <div
                    key={s(c.id)}
                    style={{ fontFamily: MONO, fontSize: 11, color: INK, padding: "3px 0" }}
                  >
                    <span style={{ color: BODY }}>{fmtDateTime(s(c.created_at))}</span> ·{" "}
                    {s(c.mode).toUpperCase()} · {s(c.purpose) || s(c.direction)} ·{" "}
                    {s(c.outcome) || s(c.status)} · disclosure{" "}
                    {Number(c.disclosure_verified ?? 0) === 1 ? (
                      <span style={{ color: GREEN }}>✓</span>
                    ) : (
                      <span style={{ color: RED }}>✗</span>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Messages */}
            <div style={drawerSection}>
              <div style={drawerLabel}>Messages</div>
              {(detail?.messages ?? []).length === 0 ? (
                <div style={{ fontFamily: MONO, fontSize: 11, color: BODY }}>No messages.</div>
              ) : (
                (detail?.messages ?? []).map((m) => (
                  <div
                    key={s(m.id)}
                    style={{ fontFamily: MONO, fontSize: 11, color: INK, padding: "3px 0" }}
                  >
                    <span style={{ color: BODY }}>{fmtDateTime(s(m.created_at))}</span> ·{" "}
                    {s(m.channel).toUpperCase()} · {s(m.template) || "(no template)"} ·{" "}
                    {s(m.status)}
                    {s(m.block_reason) ? (
                      <span style={{ color: RED }}> · {s(m.block_reason)}</span>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            {/* Consent trail */}
            <div style={drawerSection}>
              <div style={drawerLabel}>Consent trail</div>
              {(detail?.consentEvents ?? []).length === 0 ? (
                <div style={{ fontFamily: MONO, fontSize: 11, color: BODY }}>
                  No consent events recorded.
                </div>
              ) : (
                (detail?.consentEvents ?? []).map((ce) => (
                  <div
                    key={s(ce.id)}
                    title={s(ce.disclosure_text)}
                    style={{ fontFamily: MONO, fontSize: 11, color: INK, padding: "3px 0" }}
                  >
                    <span style={{ color: BODY }}>{fmtDateTime(s(ce.captured_at))}</span> ·{" "}
                    {s(ce.tier).toUpperCase()} · {s(ce.source)} · scope {s(ce.channel_scope)}
                  </div>
                ))
              )}
            </div>

            {/* Onboarding */}
            {detail?.onboarding ? (
              <div style={drawerSection}>
                <div style={drawerLabel}>Onboarding</div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: INK }}>
                  {s(detail.onboarding.status).toUpperCase()} · sent{" "}
                  {relativeTime(s(detail.onboarding.sent_at))}
                  {s(detail.onboarding.opened_at)
                    ? ` · opened ${relativeTime(s(detail.onboarding.opened_at))}`
                    : ""}
                  {s(detail.onboarding.submitted_at)
                    ? ` · submitted ${relativeTime(s(detail.onboarding.submitted_at))}`
                    : ""}
                </div>
              </div>
            ) : null}

            {s(lead.discovery_source) === "osm" && (
              <div
                style={{
                  ...drawerSection,
                  fontFamily: MONO,
                  fontSize: 10,
                  color: BODY,
                }}
              >
                Lead data © OpenStreetMap contributors
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/* --------------------------------- the panel --------------------------------- */

export default function PipelinePanel() {
  const [pipe, setPipe] = useState<PipelineData | null>(null);
  const [pipeLoading, setPipeLoading] = useState(true);
  const [pipeError, setPipeError] = useState<string | null>(null);

  const [leads, setLeads] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [consent, setConsent] = useState("");
  const [approval, setApproval] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState<string | null>(null);

  const [drawerId, setDrawerId] = useState<string | null>(null);

  const loadPipe = useCallback(async () => {
    setPipeLoading(true);
    setPipeError(null);
    try {
      setPipe(await fetchJson<PipelineData>("/api/admin/pipeline"));
    } catch (err) {
      setPipeError(err instanceof Error ? err.message : "Failed to load pipeline");
    } finally {
      setPipeLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred a tick — no synchronous setState inside the effect body.
    const t = setTimeout(loadPipe, 0);
    return () => clearTimeout(t);
  }, [loadPipe]);

  // Debounced search → query.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const loadLeads = useCallback(async () => {
    setLeadsLoading(true);
    setLeadsError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (source) params.set("source", source);
      if (consent) params.set("consent", consent);
      if (approval) params.set("approval", approval);
      if (query) params.set("q", query);
      params.set("page", String(page));
      const d = await fetchJson<LeadsData>(`/api/admin/leads?${params.toString()}`);
      setLeads(d.leads ?? []);
      setTotal(d.total ?? 0);
    } catch (err) {
      setLeadsError(err instanceof Error ? err.message : "Failed to load leads");
    } finally {
      setLeadsLoading(false);
    }
  }, [status, source, consent, approval, query, page]);

  useEffect(() => {
    // Deferred a tick — no synchronous setState inside the effect body.
    const t = setTimeout(loadLeads, 0);
    return () => clearTimeout(t);
  }, [loadLeads]);

  const refreshAll = useCallback(() => {
    loadPipe();
    loadLeads();
  }, [loadPipe, loadLeads]);

  if (pipe && pipe.configured === false) {
    return <NotConfiguredCard />;
  }

  const funnel = pipe?.funnel ?? [];
  const funnelMax = Math.max(1, ...funnel.map((f) => f.count));
  const qd = pipe?.queueDepth ?? {};
  const consentRows = pipe?.consentBreakdown ?? [];
  const consentMax = Math.max(1, ...consentRows.map((c) => c.count));
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const anyOsm = leads.some((l) => s(l.discovery_source) === "osm");

  const selStyle = { ...inputStyle, textTransform: "uppercase" as const };

  return (
    <>
      <style>{PANEL_CSS}</style>

      {pipeError && <ErrorCard message={pipeError} onRetry={loadPipe} />}
      {pipeLoading && !pipe && <Shimmer />}

      {pipe && pipe.configured && (
        <>
          {/* Funnel */}
          <div style={cardStyle}>
            <div style={kickerStyle}>Lifecycle funnel — leads per status</div>
            {funnel.map((f, i) => (
              <BarRow
                key={f.status}
                label={String(i + 1).padStart(2, "0") + " " + prettify(f.status)}
                count={f.count}
                max={funnelMax}
              />
            ))}
          </div>

          {/* Queue / heartbeat tiles */}
          <div className="vw-admin-tiles" style={{ marginTop: 16 }}>
            <StatTile label="Queue pending" value={String(qd.pending ?? 0)} />
            <StatTile label="Queue blocked" value={String(qd.blocked ?? 0)} />
            <StatTile
              label="Queue dead"
              value={String(qd.dead ?? 0)}
              color={(qd.dead ?? 0) > 0 ? RED : undefined}
            />
            <StatTile label="Last heartbeat" value={relativeTime(pipe.lastHeartbeat)} />
            <StatTile
              label="Appts next 7d"
              value={String((pipe.upcomingAppointments ?? []).length)}
            />
          </div>

          {/* Consent + activity */}
          <div className="vw-admin-grid" style={{ marginTop: 16 }}>
            <div style={cardStyle}>
              <div style={kickerStyle}>Consent breakdown</div>
              {consentRows.map((c) => (
                <BarRow
                  key={c.tier}
                  label={consentBadge(c.tier).label}
                  count={c.count}
                  max={consentMax}
                />
              ))}
            </div>
            <div style={cardStyle}>
              <div style={kickerStyle}>Recent activity</div>
              {(pipe.recentActivity ?? []).length === 0 ? (
                <div style={{ fontFamily: MONO, fontSize: 12, color: BODY }}>
                  No lead activity yet.
                </div>
              ) : (
                <div style={{ maxHeight: 280, overflowY: "auto" }}>
                  {(pipe.recentActivity ?? []).map((a) => (
                    <div
                      key={a.id}
                      onClick={() => setDrawerId(a.leadId)}
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        color: INK,
                        padding: "4px 0",
                        borderBottom: "1px solid rgba(26,33,41,.05)",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ color: BODY }}>{fmtDateTime(a.at)}</span> ·{" "}
                      <span style={{ fontWeight: 500 }}>{a.business || shortId(a.leadId)}</span>{" "}
                      · {a.actor} · {a.type}
                      {a.fromStatus || a.toStatus
                        ? ` · ${a.fromStatus ?? "∅"}→${a.toStatus ?? "∅"}`
                        : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Leads table */}
      <div style={{ ...cardStyle, marginTop: 16 }}>
        <div style={kickerStyle}>Leads</div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            style={selStyle}
          >
            <option value="">ALL STATUSES</option>
            {ALL_STATUSES.map((v) => (
              <option key={v} value={v}>
                {prettify(v)}
              </option>
            ))}
          </select>
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPage(1);
            }}
            style={selStyle}
          >
            <option value="">ALL SOURCES</option>
            {SOURCES.map((v) => (
              <option key={v} value={v}>
                {prettify(v)}
              </option>
            ))}
          </select>
          <select
            value={consent}
            onChange={(e) => {
              setConsent(e.target.value);
              setPage(1);
            }}
            style={selStyle}
          >
            <option value="">ALL CONSENT</option>
            {CONSENTS.map((v) => (
              <option key={v} value={v}>
                {prettify(v)}
              </option>
            ))}
          </select>
          <select
            value={approval}
            onChange={(e) => {
              setApproval(e.target.value);
              setPage(1);
            }}
            style={selStyle}
          >
            <option value="">ALL APPROVAL</option>
            {APPROVALS.map((v) => (
              <option key={v} value={v}>
                {prettify(v)}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="SEARCH business / contact / email / phone"
            style={{ ...inputStyle, flex: "1 1 220px", minWidth: 180 }}
          />
        </div>

        {leadsError && <ErrorCard message={leadsError} onRetry={loadLeads} />}

        <div style={{ overflowX: "auto", opacity: leadsLoading ? 0.55 : 1, transition: "opacity .2s" }}>
          <table className="vw-admin-table" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>Business</th>
                <th>Status</th>
                <th>Source</th>
                <th>Consent</th>
                <th>Approval</th>
                <th style={{ textAlign: "right" }}>Score</th>
                <th>Phone</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ fontFamily: MONO, fontSize: 12, color: BODY }}>
                    {leadsLoading ? "Loading…" : "No leads match these filters."}
                  </td>
                </tr>
              ) : (
                leads.map((l) => {
                  const cb = consentBadge(s(l.consent_tier));
                  return (
                    <tr
                      key={s(l.id)}
                      onClick={() => setDrawerId(s(l.id))}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ fontWeight: 500 }}>{s(l.business_name)}</td>
                      <td>
                        <span style={badgeStyle(LEAD_STATUS_COLORS[s(l.status)] ?? BODY)}>
                          {prettify(s(l.status))}
                        </span>
                      </td>
                      <td style={{ fontFamily: MONO, fontSize: 11 }}>
                        {s(l.discovery_source)}
                      </td>
                      <td>
                        <span style={badgeStyle(cb.color)}>{cb.label}</span>
                      </td>
                      <td style={{ fontFamily: MONO, fontSize: 11 }}>{s(l.approval)}</td>
                      <td style={{ fontFamily: MONO, fontSize: 12, textAlign: "right" }}>
                        {Number(l.score ?? 0)}
                      </td>
                      <td style={{ fontFamily: MONO, fontSize: 12, whiteSpace: "nowrap" }}>
                        {s(l.phone_e164) || "—"}
                      </td>
                      <td
                        style={{ fontFamily: MONO, fontSize: 11, color: BODY, whiteSpace: "nowrap" }}
                        title={s(l.updated_at)}
                      >
                        {relativeTime(s(l.updated_at))}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 12,
            gap: 12,
          }}
        >
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{ ...btnGhost, opacity: page <= 1 ? 0.4 : 1 }}
          >
            PREV
          </button>
          <span style={{ fontFamily: MONO, fontSize: 11, color: BODY, letterSpacing: "0.08em" }}>
            PAGE {page} / {pageCount} · {total.toLocaleString()} LEADS
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
            style={{ ...btnGhost, opacity: page >= pageCount ? 0.4 : 1 }}
          >
            NEXT
          </button>
        </div>

        {anyOsm && (
          <div style={{ fontFamily: MONO, fontSize: 10, color: BODY, marginTop: 10 }}>
            Includes leads © OpenStreetMap contributors
          </div>
        )}
      </div>

      {drawerId && (
        <LeadDrawer
          leadId={drawerId}
          onClose={() => setDrawerId(null)}
          onChanged={refreshAll}
        />
      )}
    </>
  );
}
