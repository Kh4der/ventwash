"use client";

/**
 * JobsPanel — the debuggability centerpiece: per-status count tiles (dead
 * styled red), status filter chips + type select, a paginated queue table
 * with expandable payload/error rows, a RETRY button for failed/dead/blocked
 * jobs, a SIM badge for provider no-ops, and a 15s auto-refresh while the
 * panel is mounted and the tab is visible.
 */

import { useCallback, useEffect, useState } from "react";
import {
  BODY,
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
  inputStyle,
  kickerStyle,
  postJson,
  prettify,
  relativeTime,
  shortId,
} from "./panel-shared";

interface Job {
  id: string;
  type: string;
  status: string;
  run_at: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  block_reason: string | null;
  simulated: boolean;
  lead_id: string | null;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

interface JobsData {
  configured: boolean;
  jobs?: Job[];
  total?: number;
  page?: number;
  counts?: Record<string, number>;
}

const STATUSES = ["pending", "running", "done", "failed", "dead", "blocked", "cancelled"];

const TYPES = [
  "send_email",
  "send_sms",
  "place_ai_call",
  "lookup_line_type",
  "discover_osm",
  "crawl_site",
  "score_lead",
  "onboarding_nudge",
  "daily_digest",
  "dnc_sync",
  "retention_sweep",
  "heartbeat",
];

const RETRYABLE = new Set(["failed", "dead", "blocked"]);
const PAGE_SIZE = 50;
const REFRESH_MS = 15_000;

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
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

export default function JobsPanel() {
  const [data, setData] = useState<JobsData | null>(null);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (type) params.set("type", type);
        params.set("page", String(page));
        setData(await fetchJson<JobsData>(`/api/admin/jobs?${params.toString()}`));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load jobs");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [status, type, page],
  );

  useEffect(() => {
    // Deferred a tick — no synchronous setState inside the effect body.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Auto-refresh every 15s while this panel is mounted and the tab visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) load(true);
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function retry(job: Job) {
    setBusyId(job.id);
    setRetryMsg(null);
    try {
      await postJson(`/api/admin/jobs/${job.id}/retry`, {});
      setRetryMsg(`Job ${shortId(job.id)} reset to pending.`);
      load(true);
    } catch (err) {
      setRetryMsg(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusyId(null);
    }
  }

  if (data && data.configured === false) return <NotConfiguredCard />;

  const counts = data?.counts ?? {};
  const jobs = data?.jobs ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <style>{PANEL_CSS}</style>

      {error && <ErrorCard message={error} onRetry={() => load()} />}

      {/* Counts */}
      <div className="vw-admin-tiles">
        <StatTile label="Pending" value={String(counts.pending ?? 0)} />
        <StatTile label="Running" value={String(counts.running ?? 0)} />
        <StatTile label="Blocked" value={String(counts.blocked ?? 0)} />
        <StatTile label="Failed" value={String(counts.failed ?? 0)} />
        <StatTile
          label="Dead"
          value={String(counts.dead ?? 0)}
          color={(counts.dead ?? 0) > 0 ? RED : undefined}
        />
      </div>

      {/* Queue table */}
      <div style={{ ...cardStyle, marginTop: 16 }}>
        <div style={kickerStyle}>Job queue</div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              border: "1px solid rgba(26,33,41,.1)",
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            {["", ...STATUSES].map((v) => (
              <button
                key={v || "all"}
                onClick={() => {
                  setStatus(v);
                  setPage(1);
                }}
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  padding: "7px 12px",
                  border: "none",
                  cursor: "pointer",
                  background: v === status ? INK : "#ffffff",
                  color: v === status ? "#f3f8fb" : BODY,
                }}
              >
                {v ? v.toUpperCase() : "ALL"}
              </button>
            ))}
          </div>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
            style={{ ...inputStyle, textTransform: "uppercase" }}
          >
            <option value="">ALL TYPES</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {prettify(t)}
              </option>
            ))}
          </select>
          {retryMsg && (
            <span style={{ fontFamily: MONO, fontSize: 11, color: BODY }}>{retryMsg}</span>
          )}
        </div>

        <div style={{ overflowX: "auto", opacity: loading ? 0.55 : 1, transition: "opacity .2s" }}>
          <table className="vw-admin-table" style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>Run</th>
                <th>Attempts</th>
                <th>Lead</th>
                <th />
                <th style={{ textAlign: "right" }} />
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ fontFamily: MONO, fontSize: 12, color: BODY }}>
                    {loading ? "Loading…" : "No jobs match these filters."}
                  </td>
                </tr>
              ) : (
                jobs.map((j) => {
                  const isOpen = expanded.has(j.id);
                  return (
                    <JobRow
                      key={j.id}
                      job={j}
                      open={isOpen}
                      busy={busyId === j.id}
                      onToggle={() => toggleExpand(j.id)}
                      onRetry={() => retry(j)}
                    />
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
            PAGE {page} / {pageCount} · {total.toLocaleString()} JOBS · AUTO-REFRESH 15S
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
            style={{ ...btnGhost, opacity: page >= pageCount ? 0.4 : 1 }}
          >
            NEXT
          </button>
        </div>
      </div>
    </>
  );
}

function JobRow({
  job,
  open,
  busy,
  onToggle,
  onRetry,
}: {
  job: Job;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onRetry: () => void;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td style={{ fontFamily: MONO, fontSize: 12 }}>{job.type}</td>
        <td>
          <span style={badgeStyle(JOB_STATUS_COLORS[job.status] ?? BODY)}>{job.status}</span>
          {job.simulated && (
            <span style={{ ...badgeStyle(BODY), marginLeft: 5 }}>SIM</span>
          )}
        </td>
        <td
          style={{ fontFamily: MONO, fontSize: 11, color: BODY, whiteSpace: "nowrap" }}
          title={job.run_at}
        >
          {relativeTime(job.run_at)}
        </td>
        <td style={{ fontFamily: MONO, fontSize: 12 }}>
          {job.attempts}/{job.max_attempts}
        </td>
        <td style={{ fontFamily: MONO, fontSize: 11 }} title={job.lead_id ?? undefined}>
          {shortId(job.lead_id)}
        </td>
        <td style={{ fontFamily: MONO, fontSize: 11, color: BODY }}>{open ? "▴" : "▾"}</td>
        <td style={{ textAlign: "right" }}>
          {RETRYABLE.has(job.status) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              disabled={busy}
              style={{ ...btnGhost, padding: "4px 10px", fontSize: 10, opacity: busy ? 0.5 : 1 }}
            >
              RETRY
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ background: "#f3f8fb" }}>
            <pre
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: INK,
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {JSON.stringify(
                { id: job.id, idempotency_key: job.idempotency_key, payload: job.payload },
                null,
                2,
              )}
            </pre>
            {(job.last_error || job.block_reason) && (
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  color: RED,
                  marginTop: 8,
                  wordBreak: "break-word",
                }}
              >
                {job.block_reason ? `blocked: ${job.block_reason}` : `error: ${job.last_error}`}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
