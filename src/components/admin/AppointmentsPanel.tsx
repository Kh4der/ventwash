"use client";

/**
 * AppointmentsPanel — 7-day agenda grouped by day with per-appointment
 * reminder-job pills (colored by job status, tooltips carry errors/block
 * reasons) and lifecycle actions (confirm/cancel/complete/no-show/reschedule),
 * a create card with lead search + overlap override, the weekly
 * availability-rules editor, and the read-only ICS subscribe link.
 */

import { useCallback, useEffect, useState } from "react";
import {
  APPT_STATUS_COLORS,
  BODY,
  CARD_BORDER,
  GREEN,
  HEAD,
  INK,
  JOB_STATUS_COLORS,
  MONO,
  PANEL_CSS,
  RED,
  badgeStyle,
  btnGhost,
  btnPrimary,
  cardStyle,
  fetchJson,
  fmtTime,
  inputStyle,
  kickerStyle,
  postJson,
  prettify,
} from "./panel-shared";

type Row = Record<string, unknown>;

const s = (v: unknown): string => (v == null ? "" : String(v));

interface Reminder {
  id: string;
  idempotency_key: string;
  type: string;
  status: string;
  run_at: string;
  last_error: string | null;
  block_reason: string | null;
}

interface Appt {
  id: string;
  lead_id: string;
  kind: string;
  status: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  location: string;
  notes: string;
  leadBusiness: string;
  reminders: Reminder[];
}

interface Rule {
  weekday: number;
  start_min: number;
  end_min: number;
}

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const KINDS = ["sales_call", "inspection", "cleaning"];
const DURATIONS = [60, 90, 120];

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    .replace(/,/g, "")
    .toUpperCase();
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function fmtMin(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function reminderLabel(key: string, type: string): string {
  const suffix = key.split(":")[3];
  return (suffix || type).replace(/_/g, " ").toUpperCase();
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

export default function AppointmentsPanel() {
  const [appts, setAppts] = useState<Appt[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  // Reschedule popover state (per appointment id).
  const [reschedId, setReschedId] = useState<string | null>(null);
  const [reschedStart, setReschedStart] = useState("");
  const [reschedEnd, setReschedEnd] = useState("");

  // Create form.
  const [leadId, setLeadId] = useState("");
  const [leadLabel, setLeadLabel] = useState("");
  const [leadQuery, setLeadQuery] = useState("");
  const [leadResults, setLeadResults] = useState<Row[]>([]);
  const [kind, setKind] = useState("inspection");
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState(90);
  const [location, setLocation] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [overlap, setOverlap] = useState(false);
  const [createMsg, setCreateMsg] = useState<{ text: string; err: boolean } | null>(null);

  // Availability editor.
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Record<number, { start: string; end: string }>>({});
  const [availMsg, setAvailMsg] = useState<{ text: string; err: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = new Date();
      const to = new Date(from.getTime() + 7 * 24 * 3600_000);
      const d = await fetchJson<{ configured: boolean; appointments?: Row[] }>(
        `/api/admin/appointments?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      );
      setConfigured(d.configured);
      setAppts(
        (d.appointments ?? []).map((a) => ({
          id: s(a.id),
          lead_id: s(a.lead_id),
          kind: s(a.kind),
          status: s(a.status),
          starts_at: s(a.starts_at),
          ends_at: s(a.ends_at),
          timezone: s(a.timezone),
          location: s(a.location),
          notes: s(a.notes),
          leadBusiness: s(a.leadBusiness),
          reminders: Array.isArray(a.reminders) ? (a.reminders as Reminder[]) : [],
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load appointments");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRules = useCallback(async () => {
    try {
      const d = await fetchJson<{ configured?: boolean; rules?: Rule[] }>(
        "/api/admin/availability",
      );
      setRules(
        (d.rules ?? []).map((r) => ({
          weekday: r.weekday,
          start_min: r.start_min,
          end_min: r.end_min,
        })),
      );
    } catch (err) {
      setAvailMsg({
        text: err instanceof Error ? err.message : "Failed to load availability",
        err: true,
      });
    }
  }, []);

  useEffect(() => {
    // Deferred a tick — no synchronous setState inside the effect body.
    const t = setTimeout(() => {
      load();
      loadRules();
    }, 0);
    return () => clearTimeout(t);
  }, [load, loadRules]);

  // Debounced lead search for the create card (all setState inside the timer
  // callback — nothing synchronous in the effect body).
  useEffect(() => {
    const q = leadQuery.trim();
    const t = setTimeout(
      async () => {
        if (!q) {
          setLeadResults([]);
          return;
        }
        try {
          const d = await fetchJson<{ leads?: Row[] }>(
            `/api/admin/leads?q=${encodeURIComponent(q)}`,
          );
          setLeadResults((d.leads ?? []).slice(0, 8));
        } catch {
          setLeadResults([]);
        }
      },
      q ? 350 : 0,
    );
    return () => clearTimeout(t);
  }, [leadQuery]);

  async function doAction(
    appt: Appt,
    action: string,
    extra?: { startsAt: string; endsAt: string },
  ) {
    setBusy(appt.id + ":" + action);
    setActionErr(null);
    try {
      await postJson(`/api/admin/appointments/${appt.id}`, { action, ...extra }, "PATCH");
      setReschedId(null);
      load();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : "Appointment action failed");
    } finally {
      setBusy(null);
    }
  }

  function openReschedule(appt: Appt) {
    setReschedId(reschedId === appt.id ? null : appt.id);
    setReschedStart(toLocalInput(appt.starts_at));
    setReschedEnd(toLocalInput(appt.ends_at));
  }

  async function create(force = false) {
    setCreateMsg(null);
    if (!leadId.trim() || !start) {
      setCreateMsg({ text: "A lead and a start time are required.", err: true });
      return;
    }
    setBusy("create");
    try {
      const startMs = new Date(start).getTime();
      await postJson("/api/admin/appointments", {
        leadId: leadId.trim(),
        kind,
        startsAt: new Date(startMs).toISOString(),
        endsAt: new Date(startMs + duration * 60000).toISOString(),
        location,
        confirmed,
        force,
      });
      setCreateMsg({ text: "Appointment created — reminders fanned out.", err: false });
      setOverlap(false);
      setStart("");
      load();
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        setOverlap(true);
        setCreateMsg({
          text: "Overlaps an existing appointment.",
          err: true,
        });
      } else {
        setCreateMsg({
          text: err instanceof Error ? err.message : "Appointment creation failed",
          err: true,
        });
      }
    } finally {
      setBusy(null);
    }
  }

  function addRule(weekday: number) {
    setAvailMsg(null);
    const d = draft[weekday];
    const sm = d?.start ? toMin(d.start) : null;
    const em = d?.end ? toMin(d.end) : null;
    if (sm == null || em == null || sm >= em) {
      setAvailMsg({ text: "Rule needs a start time before its end time.", err: true });
      return;
    }
    setRules((prev) => [...prev, { weekday, start_min: sm, end_min: em }]);
    setDraft((prev) => ({ ...prev, [weekday]: { start: "", end: "" } }));
  }

  function removeRule(rule: Rule) {
    setRules((prev) => prev.filter((r) => r !== rule));
  }

  async function saveRules() {
    setBusy("availability");
    setAvailMsg(null);
    try {
      const res = await postJson<{ ok: boolean; rules: Rule[] }>(
        "/api/admin/availability",
        { rules },
        "PUT",
      );
      setRules(
        (res.rules ?? []).map((r) => ({
          weekday: r.weekday,
          start_min: r.start_min,
          end_min: r.end_min,
        })),
      );
      setAvailMsg({ text: "Availability saved.", err: false });
    } catch (err) {
      setAvailMsg({
        text: err instanceof Error ? err.message : "Availability save failed",
        err: true,
      });
    } finally {
      setBusy(null);
    }
  }

  if (configured === false) return <NotConfiguredCard />;

  // Group the agenda by day (order preserved — API sorts by starts_at ASC).
  const byDay = new Map<string, Appt[]>();
  for (const a of appts) {
    const key = dayLabel(a.starts_at);
    const list = byDay.get(key) ?? [];
    list.push(a);
    byDay.set(key, list);
  }

  return (
    <>
      <style>{PANEL_CSS}</style>

      {error && <ErrorCard message={error} onRetry={load} />}
      {actionErr && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: RED, marginBottom: 10 }}>
          {actionErr}
        </div>
      )}

      {/* 7-day agenda */}
      <div style={{ ...cardStyle, opacity: loading ? 0.55 : 1, transition: "opacity .2s" }}>
        <div style={kickerStyle}>Agenda — next 7 days</div>
        {appts.length === 0 ? (
          <div style={{ fontFamily: MONO, fontSize: 12, color: BODY, padding: "20px 0" }}>
            {loading ? "Loading…" : "No appointments in the next 7 days."}
          </div>
        ) : (
          [...byDay.entries()].map(([day, list]) => (
            <div key={day} style={{ marginBottom: 18 }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  color: INK,
                  borderBottom: CARD_BORDER,
                  paddingBottom: 5,
                  marginBottom: 10,
                }}
              >
                {day}
              </div>
              {list.map((a) => {
                const canConfirm = a.status === "tentative";
                const active =
                  a.status === "tentative" ||
                  a.status === "confirmed" ||
                  a.status === "rescheduled";
                const canComplete = a.status === "confirmed" || a.status === "rescheduled";
                return (
                  <div
                    key={a.id}
                    style={{
                      border: CARD_BORDER,
                      borderRadius: 6,
                      padding: "12px 14px",
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, color: INK }}>
                        {fmtTime(a.starts_at, a.timezone)}–{fmtTime(a.ends_at, a.timezone)}
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: 10, color: BODY }}>
                        {a.timezone}
                      </span>
                      <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 14, color: INK }}>
                        {a.leadBusiness || "(unknown business)"}
                      </span>
                      <span style={badgeStyle(BODY)}>{prettify(a.kind)}</span>
                      <span style={badgeStyle(APPT_STATUS_COLORS[a.status] ?? BODY)}>
                        {prettify(a.status)}
                      </span>
                    </div>

                    {a.location && (
                      <div style={{ fontFamily: MONO, fontSize: 11, color: BODY, marginTop: 6 }}>
                        @ {a.location}
                      </div>
                    )}

                    {a.reminders.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          marginTop: 8,
                        }}
                      >
                        {a.reminders.map((r) => (
                          <span
                            key={r.id}
                            title={
                              r.last_error ||
                              r.block_reason ||
                              `${r.status} · run ${r.run_at}`
                            }
                            style={badgeStyle(JOB_STATUS_COLORS[r.status] ?? BODY)}
                          >
                            {reminderLabel(r.idempotency_key, r.type)}
                          </span>
                        ))}
                      </div>
                    )}

                    {active && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                        {canConfirm && (
                          <button
                            onClick={() => doAction(a, "confirm")}
                            disabled={busy !== null}
                            style={btnGhost}
                          >
                            CONFIRM
                          </button>
                        )}
                        {canComplete && (
                          <>
                            <button
                              onClick={() => doAction(a, "complete")}
                              disabled={busy !== null}
                              style={btnGhost}
                            >
                              COMPLETE
                            </button>
                            <button
                              onClick={() => doAction(a, "no_show")}
                              disabled={busy !== null}
                              style={btnGhost}
                            >
                              NO-SHOW
                            </button>
                          </>
                        )}
                        <button onClick={() => openReschedule(a)} style={btnGhost}>
                          RESCHEDULE
                        </button>
                        <button
                          onClick={() => doAction(a, "cancel")}
                          disabled={busy !== null}
                          style={{ ...btnGhost, color: RED, borderColor: "rgba(176,74,69,.4)" }}
                        >
                          CANCEL
                        </button>
                      </div>
                    )}

                    {reschedId === a.id && (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 8,
                          marginTop: 10,
                          padding: 10,
                          background: "#f3f8fb",
                          borderRadius: 6,
                        }}
                      >
                        <input
                          type="datetime-local"
                          value={reschedStart}
                          onChange={(e) => setReschedStart(e.target.value)}
                          style={inputStyle}
                        />
                        <span style={{ fontFamily: MONO, fontSize: 11, color: BODY }}>→</span>
                        <input
                          type="datetime-local"
                          value={reschedEnd}
                          onChange={(e) => setReschedEnd(e.target.value)}
                          style={inputStyle}
                        />
                        <button
                          onClick={() => {
                            const sMs = new Date(reschedStart).getTime();
                            const eMs = new Date(reschedEnd).getTime();
                            if (Number.isNaN(sMs) || Number.isNaN(eMs) || sMs >= eMs) {
                              setActionErr("Reschedule needs a valid start before its end.");
                              return;
                            }
                            doAction(a, "reschedule", {
                              startsAt: new Date(sMs).toISOString(),
                              endsAt: new Date(eMs).toISOString(),
                            });
                          }}
                          disabled={busy !== null}
                          style={btnPrimary}
                        >
                          APPLY
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="vw-admin-grid" style={{ marginTop: 16 }}>
        {/* Create */}
        <div style={cardStyle}>
          <div style={kickerStyle}>Create appointment</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              value={leadId}
              onChange={(e) => {
                setLeadId(e.target.value);
                setLeadLabel("");
              }}
              placeholder="LEAD ID (paste, or search below)"
              style={inputStyle}
            />
            <div>
              <input
                value={leadQuery}
                onChange={(e) => setLeadQuery(e.target.value)}
                placeholder="SEARCH LEAD BY NAME…"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
              />
              {leadResults.length > 0 && (
                <div style={{ border: CARD_BORDER, borderRadius: 3, marginTop: 4 }}>
                  {leadResults.map((l) => (
                    <button
                      key={s(l.id)}
                      onClick={() => {
                        setLeadId(s(l.id));
                        setLeadLabel(s(l.business_name));
                        setLeadResults([]);
                        setLeadQuery("");
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        fontFamily: MONO,
                        fontSize: 11,
                        padding: "6px 10px",
                        border: "none",
                        borderBottom: "1px solid rgba(26,33,41,.06)",
                        background: "#ffffff",
                        color: INK,
                        cursor: "pointer",
                      }}
                    >
                      {s(l.business_name)}{" "}
                      <span style={{ color: BODY }}>
                        {[s(l.city), s(l.region)].filter(Boolean).join(", ")}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {leadLabel && (
                <div style={{ fontFamily: MONO, fontSize: 11, color: GREEN, marginTop: 4 }}>
                  → {leadLabel}
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <select value={kind} onChange={(e) => setKind(e.target.value)} style={inputStyle}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {prettify(k)}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                style={inputStyle}
              />
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                style={inputStyle}
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} MIN
                  </option>
                ))}
              </select>
            </div>

            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="LOCATION (optional)"
              style={inputStyle}
            />

            <label
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: BODY,
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              CREATE AS CONFIRMED
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => create(false)}
                disabled={busy === "create"}
                style={{ ...btnPrimary, opacity: busy === "create" ? 0.6 : 1 }}
              >
                CREATE
              </button>
              {overlap && (
                <button
                  onClick={() => create(true)}
                  disabled={busy === "create"}
                  style={{ ...btnGhost, color: RED, borderColor: "rgba(176,74,69,.4)" }}
                >
                  CREATE ANYWAY
                </button>
              )}
            </div>
            {createMsg && (
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  color: createMsg.err ? RED : GREEN,
                }}
              >
                {createMsg.text}
              </div>
            )}
          </div>
        </div>

        {/* Availability + ICS */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={cardStyle}>
            <div style={kickerStyle}>Availability — weekly rules</div>
            {WEEKDAYS.map((label, w) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 6,
                  padding: "6px 0",
                  borderBottom: "1px solid rgba(26,33,41,.05)",
                }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    letterSpacing: "0.1em",
                    color: INK,
                    width: 36,
                    flexShrink: 0,
                  }}
                >
                  {label}
                </span>
                {rules
                  .filter((r) => r.weekday === w)
                  .map((r, i) => (
                    <span
                      key={`${w}-${i}-${r.start_min}`}
                      style={{
                        ...badgeStyle(INK),
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      {fmtMin(r.start_min)}–{fmtMin(r.end_min)}
                      <button
                        onClick={() => removeRule(r)}
                        aria-label="Remove rule"
                        style={{
                          border: "none",
                          background: "none",
                          color: BODY,
                          cursor: "pointer",
                          padding: 0,
                          fontSize: 10,
                          lineHeight: 1,
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                <input
                  type="time"
                  value={draft[w]?.start ?? ""}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      [w]: { start: e.target.value, end: p[w]?.end ?? "" },
                    }))
                  }
                  style={{ ...inputStyle, padding: "3px 6px", fontSize: 11 }}
                />
                <input
                  type="time"
                  value={draft[w]?.end ?? ""}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      [w]: { start: p[w]?.start ?? "", end: e.target.value },
                    }))
                  }
                  style={{ ...inputStyle, padding: "3px 6px", fontSize: 11 }}
                />
                <button
                  onClick={() => addRule(w)}
                  style={{ ...btnGhost, padding: "4px 9px", fontSize: 10 }}
                >
                  ADD
                </button>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
              <button
                onClick={saveRules}
                disabled={busy === "availability"}
                style={{ ...btnPrimary, opacity: busy === "availability" ? 0.6 : 1 }}
              >
                SAVE ALL
              </button>
              {availMsg && (
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    color: availMsg.err ? RED : GREEN,
                  }}
                >
                  {availMsg.text}
                </span>
              )}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={kickerStyle}>Calendar feed</div>
            <a
              href="/api/admin/calendar.ics?key="
              style={{
                fontFamily: MONO,
                fontSize: 12,
                color: "#3E6FA6",
                letterSpacing: "0.06em",
              }}
            >
              SUBSCRIBE (ICS)
            </a>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: BODY,
                lineHeight: 1.7,
                marginTop: 8,
              }}
            >
              Set ADMIN_ICS_FEED_KEY in .env.local and append it to the key=
              parameter — calendar apps poll this read-only feed, no OAuth needed.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
