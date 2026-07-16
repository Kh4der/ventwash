"use client";

/**
 * ReviewPanel — the human-in-the-loop cold-outreach gate: the review queue
 * (leads at status=review_queue, approval=pending, ordered by score DESC)
 * with per-row expand explaining what approval legally means, bulk approve
 * hard-capped at 25 + reject, a CSV import card with column-mapping preview,
 * and a founder-triggered OSM discovery sweep.
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

type Row = Record<string, unknown>;

const s = (v: unknown): string => (v == null ? "" : String(v));

const MAX_BULK = 25;
const PAGE_SIZE = 50;

const APPROVAL_NOTE =
  "Approval authorizes cold outreach to this business. It is logged with your name and timestamp.";

interface LeadsData {
  configured: boolean;
  leads?: Row[];
  total?: number;
  page?: number;
}

interface ApproveResult {
  ok: boolean;
  action: string;
  results: { id: string; ok: boolean; error?: string }[];
}

interface ImportResult {
  ok: boolean;
  created: number;
  deduped: number;
  tombstoned: number;
  invalid: number;
  totalRows: number;
  processedRows: number;
  columns: Record<string, string | null>;
  samples: Record<string, string>[];
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

export default function ReviewPanel() {
  const [leads, setLeads] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkMsg, setBulkMsg] = useState<{ text: string; err: boolean } | null>(null);

  const [csv, setCsv] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  const [discoveryMsg, setDiscoveryMsg] = useState<{ text: string; err: boolean } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchJson<LeadsData>(
        `/api/admin/leads?status=review_queue&approval=pending&page=${page}`,
      );
      setConfigured(d.configured);
      // Review queue is ordered by score DESC (sorted client-side).
      setLeads([...(d.leads ?? [])].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0)));
      setTotal(d.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review queue");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    // Deferred a tick — no synchronous setState inside the effect body.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_BULK) {
          setBulkMsg({ text: `Selection is hard-capped at ${MAX_BULK} leads per action.`, err: true });
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulk(action: "approve" | "reject") {
    if (selected.size === 0) return;
    setBusy(action);
    setBulkMsg(null);
    try {
      const res = await postJson<ApproveResult>("/api/admin/leads/approve", {
        ids: [...selected],
        action,
      });
      const ok = res.results.filter((r) => r.ok).length;
      const failed = res.results.filter((r) => !r.ok);
      setBulkMsg({
        text:
          `${action === "approve" ? "Approved" : "Rejected"} ${ok}` +
          (failed.length
            ? ` · ${failed.length} failed (${failed
                .map((f) => f.error ?? "error")
                .slice(0, 3)
                .join(", ")})`
            : ""),
        err: failed.length > 0,
      });
      setSelected(new Set());
      load();
    } catch (err) {
      setBulkMsg({
        text: err instanceof Error ? err.message : "Bulk action failed",
        err: true,
      });
    } finally {
      setBusy(null);
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  async function runImport() {
    if (!csv.trim()) {
      setImportErr("Paste CSV content or choose a file first.");
      return;
    }
    setBusy("import");
    setImportErr(null);
    setImportResult(null);
    try {
      const res = await postJson<ImportResult>("/api/admin/leads/import", { csv });
      setImportResult(res);
      load();
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  async function runDiscovery() {
    setBusy("discovery");
    setDiscoveryMsg(null);
    try {
      const res = await postJson<{ ok: boolean; jobId: string | null }>(
        "/api/admin/discovery/run",
        { task: "osm" },
      );
      setDiscoveryMsg({
        text: res.jobId
          ? `OSM sweep queued (job ${shortId(res.jobId)}).`
          : "A sweep is already queued this hour — deduped.",
        err: false,
      });
    } catch (err) {
      setDiscoveryMsg({
        text: err instanceof Error ? err.message : "Discovery enqueue failed",
        err: true,
      });
    } finally {
      setBusy(null);
    }
  }

  if (configured === false) return <NotConfiguredCard />;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <style>{PANEL_CSS}</style>

      {error && <ErrorCard message={error} onRetry={load} />}

      {/* Review queue */}
      <div style={cardStyle}>
        <div style={kickerStyle}>Review queue — cold-outreach gate</div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <button
            onClick={() => bulk("approve")}
            disabled={selected.size === 0 || busy !== null}
            style={{
              ...btnPrimary,
              opacity: selected.size === 0 || busy !== null ? 0.5 : 1,
            }}
          >
            APPROVE SELECTED ({selected.size}/{MAX_BULK})
          </button>
          <button
            onClick={() => bulk("reject")}
            disabled={selected.size === 0 || busy !== null}
            style={{ ...btnGhost, opacity: selected.size === 0 || busy !== null ? 0.5 : 1 }}
          >
            REJECT SELECTED
          </button>
          {bulkMsg && (
            <span
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: bulkMsg.err ? RED : GREEN,
              }}
            >
              {bulkMsg.text}
            </span>
          )}
        </div>

        <div style={{ overflowX: "auto", opacity: loading ? 0.55 : 1, transition: "opacity .2s" }}>
          <table className="vw-admin-table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ width: 34 }} />
                <th>Business</th>
                <th>Source / provenance</th>
                <th style={{ textAlign: "right" }}>Score</th>
                <th>Contact points</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ fontFamily: MONO, fontSize: 12, color: BODY }}>
                    {loading ? "Loading…" : "Review queue is empty — nothing awaits approval."}
                  </td>
                </tr>
              ) : (
                leads.map((l) => {
                  const id = s(l.id);
                  const isOpen = expanded.has(id);
                  const contact = [s(l.phone_e164), s(l.email)].filter(Boolean).join(" · ");
                  return (
                    <ReviewRow
                      key={id}
                      lead={l}
                      contact={contact}
                      checked={selected.has(id)}
                      open={isOpen}
                      onCheck={() => toggleSelect(id)}
                      onToggle={() => toggleExpand(id)}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {total > PAGE_SIZE && (
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
            <span style={{ fontFamily: MONO, fontSize: 11, color: BODY }}>
              PAGE {page} / {pageCount} · {total.toLocaleString()} PENDING
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
              style={{ ...btnGhost, opacity: page >= pageCount ? 0.4 : 1 }}
            >
              NEXT
            </button>
          </div>
        )}
      </div>

      {/* Import + discovery */}
      <div className="vw-admin-grid" style={{ marginTop: 16 }}>
        <div style={cardStyle}>
          <div style={kickerStyle}>CSV import</div>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={"business,phone,email,website,address,city,state,zip\nAcme Diner,555-201-3344,…"}
            rows={6}
            style={{
              ...inputStyle,
              width: "100%",
              resize: "vertical",
              boxSizing: "border-box",
              marginBottom: 10,
            }}
          />
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={onFile}
              style={{ fontFamily: MONO, fontSize: 11, color: BODY }}
            />
            <button
              onClick={runImport}
              disabled={busy === "import"}
              style={{ ...btnPrimary, opacity: busy === "import" ? 0.6 : 1 }}
            >
              IMPORT
            </button>
          </div>
          {importErr && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: RED, marginTop: 8 }}>
              {importErr}
            </div>
          )}
          {importResult && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontFamily: MONO, fontSize: 11, color: INK, lineHeight: 1.9 }}>
                <span style={{ color: GREEN }}>created {importResult.created}</span> · deduped{" "}
                {importResult.deduped} · tombstoned {importResult.tombstoned} ·{" "}
                <span style={{ color: importResult.invalid > 0 ? RED : BODY }}>
                  invalid {importResult.invalid}
                </span>{" "}
                · processed {importResult.processedRows}/{importResult.totalRows} rows
              </div>
              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table className="vw-admin-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Mapped column</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(importResult.columns).map(([field, col]) => (
                      <tr key={field}>
                        <td style={{ fontFamily: MONO, fontSize: 11 }}>{field}</td>
                        <td style={{ fontFamily: MONO, fontSize: 11, color: col ? INK : BODY }}>
                          {col ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importResult.samples.length > 0 && (
                <div style={{ overflowX: "auto", marginTop: 8 }}>
                  <table className="vw-admin-table" style={{ minWidth: 560 }}>
                    <thead>
                      <tr>
                        {Object.keys(importResult.samples[0]).map((k) => (
                          <th key={k}>{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.samples.map((row, i) => (
                        <tr key={i}>
                          {Object.keys(importResult.samples[0]).map((k) => (
                            <td key={k} style={{ fontFamily: MONO, fontSize: 11 }}>
                              {row[k] || "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <div style={kickerStyle}>Discovery</div>
          <button
            onClick={runDiscovery}
            disabled={busy === "discovery"}
            style={{ ...btnPrimary, opacity: busy === "discovery" ? 0.6 : 1 }}
          >
            RUN OSM DISCOVERY SWEEP
          </button>
          {discoveryMsg && (
            <div
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: discoveryMsg.err ? RED : GREEN,
                marginTop: 8,
              }}
            >
              {discoveryMsg.text}
            </div>
          )}
          <div
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: BODY,
              lineHeight: 1.7,
              marginTop: 12,
              borderTop: CARD_BORDER,
              paddingTop: 12,
            }}
          >
            The DISCOVERY and CRAWLER toggles in the kill-switch strip gate actual
            execution — an enqueued sweep sits blocked while its channel is off.
            OSM data is used under ODbL: © OpenStreetMap contributors.
          </div>
        </div>
      </div>
    </>
  );
}

function ReviewRow({
  lead,
  contact,
  checked,
  open,
  onCheck,
  onToggle,
}: {
  lead: Row;
  contact: string;
  checked: boolean;
  open: boolean;
  onCheck: () => void;
  onToggle: () => void;
}) {
  return (
    <>
      <tr>
        <td>
          <input type="checkbox" checked={checked} onChange={onCheck} style={{ cursor: "pointer" }} />
        </td>
        <td style={{ fontWeight: 500 }}>{s(lead.business_name)}</td>
        <td style={{ fontFamily: MONO, fontSize: 11 }}>
          {prettify(s(lead.discovery_source))}
          {s(lead.provenance_note) ? (
            <span style={{ color: BODY }}> · {s(lead.provenance_note)}</span>
          ) : null}
        </td>
        <td style={{ fontFamily: MONO, fontSize: 12, textAlign: "right" }}>
          {Number(lead.score ?? 0)}
        </td>
        <td style={{ fontFamily: MONO, fontSize: 11 }}>{contact || "—"}</td>
        <td>
          <button
            onClick={onToggle}
            aria-label={open ? "Collapse" : "Expand"}
            style={{
              fontFamily: MONO,
              fontSize: 12,
              border: "none",
              background: "none",
              color: BODY,
              cursor: "pointer",
              padding: 0,
            }}
          >
            {open ? "▴" : "▾"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ background: "#f3f8fb" }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: INK, lineHeight: 1.8 }}>
              {APPROVAL_NOTE}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: BODY, marginTop: 6 }}>
              {s(lead.website) ? `web: ${s(lead.website)} · ` : ""}
              {[s(lead.city), s(lead.region)].filter(Boolean).join(", ") || "no location"} ·
              discovered {relativeTime(s(lead.created_at))} · id {shortId(s(lead.id))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
