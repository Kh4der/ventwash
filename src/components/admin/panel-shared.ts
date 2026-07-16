/**
 * panel-shared.ts — client-safe helpers shared by the admin panels: the site
 * style constants (mirroring Dashboard.tsx exactly), reusable inline-style
 * objects, status → color maps, time formatting, and a fetchJson wrapper that
 * redirects to /admin/login on 401 and throws the API's { error } string
 * otherwise. No server imports — every consumer is a "use client" component.
 */

import type { CSSProperties } from "react";

/* ------------------------------ site constants ----------------------------- */

export const INK = "#1a2129";
export const ACCENT = "#3E6FA6";
export const ACCENT_SOFT = "#9db8d2";
export const BODY = "#414c57";
export const MONO = "'IBM Plex Mono',monospace";
export const HEAD = "'Archivo',sans-serif";
export const CARD_BORDER = "1px solid rgba(26,33,41,.1)";

export const GREEN = "#3d8a4e";
export const RED = "#b04a45";
export const AMBER = "#b07d2e";

export const cardStyle: CSSProperties = {
  background: "#ffffff",
  border: CARD_BORDER,
  borderRadius: 8,
  padding: 20,
};

export const kickerStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: BODY,
  marginBottom: 12,
};

export const btnPrimary: CSSProperties = {
  fontFamily: HEAD,
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: "0.06em",
  padding: "8px 16px",
  border: "none",
  borderRadius: 3,
  background: INK,
  color: "#f3f8fb",
  cursor: "pointer",
};

export const btnGhost: CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  letterSpacing: "0.08em",
  padding: "7px 12px",
  border: CARD_BORDER,
  borderRadius: 3,
  background: "#ffffff",
  color: BODY,
  cursor: "pointer",
};

export const inputStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: 12,
  padding: "7px 10px",
  border: CARD_BORDER,
  borderRadius: 3,
  color: INK,
  background: "#ffffff",
  outline: "none",
};

export const monoNote: CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  color: BODY,
  lineHeight: 1.7,
};

/** Small bordered mono chip in the given color (status badges, pills). */
export function badgeStyle(color: string): CSSProperties {
  return {
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color,
    border: `1px solid ${color}`,
    borderRadius: 3,
    padding: "2px 7px",
    display: "inline-block",
    whiteSpace: "nowrap",
  };
}

/**
 * The same table/grid classes Dashboard.tsx defines — duplicated verbatim so
 * each panel stays self-contained (identical CSS rules are a safe no-op).
 */
export const PANEL_CSS = `
.vw-admin-tiles{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}
.vw-admin-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media (max-width:900px){
  .vw-admin-tiles{grid-template-columns:1fr 1fr}
  .vw-admin-grid{grid-template-columns:1fr}
}
.vw-admin-table{width:100%;border-collapse:collapse}
.vw-admin-table th{font-family:${MONO};font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:${BODY};text-align:left;padding:8px 10px;border-bottom:${CARD_BORDER}}
.vw-admin-table td{font-size:13px;color:${INK};padding:9px 10px;border-bottom:1px solid rgba(26,33,41,.06);vertical-align:top}
.vw-admin-table tr:last-child td{border-bottom:none}
`;

/* -------------------------------- color maps -------------------------------- */

export const LEAD_STATUS_COLORS: Record<string, string> = {
  discovered: BODY,
  enriched: BODY,
  review_queue: AMBER,
  approved_outreach: ACCENT,
  contacting: ACCENT,
  engaged: ACCENT,
  appointment_scheduled: GREEN,
  won_pending_onboarding: GREEN,
  onboarded: GREEN,
  inspection_scheduled: GREEN,
  customer: GREEN,
  lost: BODY,
  do_not_contact: RED,
};

export const JOB_STATUS_COLORS: Record<string, string> = {
  pending: BODY,
  running: ACCENT,
  done: GREEN,
  failed: RED,
  dead: RED,
  blocked: AMBER,
  cancelled: BODY,
};

export const APPT_STATUS_COLORS: Record<string, string> = {
  tentative: AMBER,
  confirmed: GREEN,
  rescheduled: ACCENT,
  completed: GREEN,
  cancelled: BODY,
  no_show: RED,
};

export const SEVERITY_COLORS: Record<string, string> = {
  info: ACCENT,
  warn: AMBER,
  critical: RED,
};

/** Consent tier → badge label + color (green/blue/amber per spec §8). */
export function consentBadge(tier: string): { label: string; color: string } {
  if (tier === "express_written") return { label: "EXPRESS WRITTEN", color: GREEN };
  if (tier === "express") return { label: "EXPRESS", color: ACCENT };
  return { label: "COLD — AI LOCKED", color: AMBER };
}

/* --------------------------------- formatting -------------------------------- */

/** snake_case → "SNAKE CASE". */
export function prettify(s: string): string {
  return s.replace(/_/g, " ").toUpperCase();
}

/** First 8 chars of a UUID-ish id (or an em dash). */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

/** "3m ago" / "2h ago" / "5d ago" / "in 4h" — null-safe. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return String(iso);
  const diff = Date.now() - t;
  const mins = Math.round(Math.abs(diff) / 60000);
  if (mins < 1) return "just now";
  let label: string;
  if (mins < 60) label = mins + "m";
  else if (mins < 48 * 60) label = Math.round(mins / 60) + "h";
  else label = Math.round(mins / 1440) + "d";
  return diff >= 0 ? label + " ago" : "in " + label;
}

/** "Jul 21, 9:30 AM" — optionally rendered in a specific IANA timezone. */
export function fmtDateTime(iso: string | null | undefined, tz?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  try {
    return d.toLocaleString(undefined, tz ? { ...opts, timeZone: tz } : opts);
  } catch {
    return d.toLocaleString(undefined, opts);
  }
}

/** "9:30 AM" — optionally in a specific IANA timezone. */
export function fmtTime(iso: string | null | undefined, tz?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  try {
    return d.toLocaleTimeString(undefined, tz ? { ...opts, timeZone: tz } : opts);
  } catch {
    return d.toLocaleTimeString(undefined, opts);
  }
}

/* ---------------------------------- fetching --------------------------------- */

export interface ApiError extends Error {
  status: number;
}

/**
 * fetch → JSON with the admin conventions: no-store, 401 ⇒ hard redirect to
 * /admin/login (the returned promise never settles — the page is navigating),
 * non-2xx ⇒ throws Error whose message is the API's { error } string.
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (res.status === 401) {
    window.location.href = "/admin/login";
    return new Promise<T>(() => {
      /* navigating away — never settles */
    });
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const message =
      data &&
      typeof data === "object" &&
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    const err = new Error(message) as ApiError;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

/** JSON-body convenience wrapper over fetchJson (POST by default). */
export function postJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  return fetchJson<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
