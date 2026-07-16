"use client";

/**
 * FlagStrip — the persistent kill-switch strip rendered above the tab bar on
 * every admin tab: one toggle pill per channel_flags row (optimistic toggle
 * via POST /api/admin/flags with revert on error) plus a red banner for
 * unacknowledged CRITICAL alerts with per-alert ACK buttons. Fetches its data
 * from /api/admin/compliance (flags + alerts only).
 */

import { useCallback, useEffect, useState } from "react";
import {
  BODY,
  CARD_BORDER,
  GREEN,
  INK,
  MONO,
  RED,
  fetchJson,
  postJson,
  relativeTime,
} from "./panel-shared";

interface Flag {
  channel: string;
  enabled: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

interface Alert {
  id: number;
  at: string;
  severity: string;
  kind: string;
  message: string;
  acknowledged_at: string | null;
}

interface ComplianceLite {
  configured: boolean;
  flags?: Flag[];
  alerts?: Alert[];
}

const CHANNEL_LABELS: Record<string, string> = {
  voice_outbound_ai: "AI CALLS",
  voice_outbound_bridge: "BRIDGE",
  sms: "SMS",
  email_transactional: "EMAIL",
  email_cold: "COLD EMAIL",
  crawler: "CRAWLER",
  discovery: "DISCOVERY",
};

const CHANNEL_ORDER = Object.keys(CHANNEL_LABELS);

const OFF_DOT = "rgba(178,53,48,.55)"; // #b23530-ish red-grey

function sortFlags(flags: Flag[]): Flag[] {
  return [...flags].sort(
    (a, b) => CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel),
  );
}

export default function FlagStrip() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<ComplianceLite>("/api/admin/compliance");
      setConfigured(data.configured);
      setFlags(sortFlags(data.flags ?? []));
      setAlerts(
        (data.alerts ?? []).filter(
          (a) => a.severity === "critical" && !a.acknowledged_at,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channel flags");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred a tick — no synchronous setState inside the effect body.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function toggle(flag: Flag) {
    setError(null);
    const next = !flag.enabled;
    // Optimistic flip …
    setFlags((prev) =>
      prev.map((f) => (f.channel === flag.channel ? { ...f, enabled: next } : f)),
    );
    try {
      const res = await postJson<{ ok?: boolean; flags?: Flag[] }>(
        "/api/admin/flags",
        { channel: flag.channel, enabled: next },
      );
      if (res.flags) setFlags(sortFlags(res.flags));
    } catch (err) {
      // … revert on error.
      setFlags((prev) =>
        prev.map((f) =>
          f.channel === flag.channel ? { ...f, enabled: flag.enabled } : f,
        ),
      );
      setError(err instanceof Error ? err.message : "Flag toggle failed");
    }
  }

  async function ack(id: number) {
    try {
      await postJson(`/api/admin/alerts/${id}/ack`, {});
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Alert ack failed");
    }
  }

  if (loading && configured === null) {
    return (
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: "0.08em",
          color: BODY,
          padding: "8px 0",
          marginBottom: 16,
        }}
      >
        LOADING CHANNEL FLAGS…
      </div>
    );
  }

  if (configured === false) {
    return (
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: "0.08em",
          color: BODY,
          padding: "8px 0",
          marginBottom: 16,
        }}
      >
        Automation database not configured — see .env.example
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: BODY,
            marginRight: 4,
          }}
        >
          Kill switches
        </span>
        {flags.map((f) => (
          <button
            key={f.channel}
            onClick={() => toggle(f)}
            title={
              (f.enabled ? "Enabled" : "Disabled") +
              (f.updated_at ? ` · changed ${relativeTime(f.updated_at)}` : "") +
              " — click to toggle"
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: "0.08em",
              padding: "6px 12px",
              border: CARD_BORDER,
              borderRadius: 999,
              background: "#ffffff",
              color: f.enabled ? INK : BODY,
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: f.enabled ? GREEN : OFF_DOT,
                flexShrink: 0,
              }}
            />
            {CHANNEL_LABELS[f.channel] ?? f.channel.toUpperCase()}
          </button>
        ))}
      </div>

      {error && (
        <div
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: RED,
            marginTop: 8,
          }}
        >
          {error}{" "}
          <button
            onClick={load}
            style={{
              fontFamily: MONO,
              fontSize: 11,
              border: "none",
              background: "none",
              color: RED,
              textDecoration: "underline",
              cursor: "pointer",
              padding: 0,
            }}
          >
            RETRY
          </button>
        </div>
      )}

      {alerts.length > 0 && (
        <div
          style={{
            background: "#fdf3f2",
            border: "1px solid rgba(224,138,134,.5)",
            borderRadius: 8,
            padding: "12px 16px",
            marginTop: 10,
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: RED,
              marginBottom: 8,
            }}
          >
            Critical alerts — unacknowledged
          </div>
          {alerts.map((a) => (
            <div
              key={a.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "5px 0",
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 12,
                  color: INK,
                  wordBreak: "break-word",
                }}
              >
                {a.kind.toUpperCase()} · {a.message}{" "}
                <span style={{ color: BODY }}>({relativeTime(a.at)})</span>
              </span>
              <button
                onClick={() => ack(a.id)}
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  padding: "5px 12px",
                  border: `1px solid ${RED}`,
                  borderRadius: 3,
                  background: "#ffffff",
                  color: RED,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                ACK
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
