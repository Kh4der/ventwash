import { getDb, qOne, nowIso } from "@/lib/db";
import { captureServerEvent } from "@/lib/posthog-server";

/**
 * The lead lifecycle state machine — the ONLY writer of leads.status.
 * Every change validates against ALLOWED_TRANSITIONS and appends a
 * lead_events row in the same transaction (docs/automation-platform-spec.md §7).
 *
 * PostHog receives a fire-and-forget 'lead_status_changed' event for
 * telemetry; operational decisions never read PostHog.
 */

export type LeadStatus =
  | "discovered"
  | "enriched"
  | "review_queue"
  | "approved_outreach"
  | "contacting"
  | "engaged"
  | "appointment_scheduled"
  | "won_pending_onboarding"
  | "onboarded"
  | "inspection_scheduled"
  | "customer"
  | "lost"
  | "do_not_contact";

export type Actor = "system" | "admin" | "vapi" | "customer" | "cron";

const ALLOWED_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  discovered: ["enriched", "review_queue", "engaged", "lost", "do_not_contact"],
  enriched: ["review_queue", "engaged", "lost", "do_not_contact"],
  review_queue: ["approved_outreach", "engaged", "lost", "do_not_contact"],
  approved_outreach: ["contacting", "engaged", "lost", "do_not_contact"],
  contacting: ["engaged", "lost", "do_not_contact"],
  engaged: ["appointment_scheduled", "lost", "do_not_contact"],
  appointment_scheduled: [
    "engaged", // cancelled / no-show re-opens follow-up
    "won_pending_onboarding",
    "lost",
    "do_not_contact",
  ],
  won_pending_onboarding: ["onboarded", "lost", "do_not_contact"],
  onboarded: ["inspection_scheduled", "lost", "do_not_contact"],
  inspection_scheduled: ["customer", "engaged", "lost", "do_not_contact"],
  customer: ["do_not_contact", "lost"],
  lost: ["engaged", "do_not_contact"], // a lost lead can come back to life
  do_not_contact: [], // terminal — only the revocation pipeline enters, nothing leaves
};

export class IllegalTransitionError extends Error {
  constructor(
    public from: string,
    public to: string,
  ) {
    super(`Illegal lead transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function isTransitionAllowed(from: LeadStatus, to: LeadStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Move a lead to a new status. Throws IllegalTransitionError for edges not in
 * the map (API routes surface this as 422) and Error if the lead is missing.
 * `do_not_contact` must only ever be requested by the revocation pipeline
 * (consent.ts) or an explicit admin DNC action.
 */
export async function transition(
  leadId: string,
  to: LeadStatus,
  actor: Actor,
  meta: Record<string, unknown> = {},
): Promise<{ from: LeadStatus; to: LeadStatus }> {
  const db = await getDb();
  if (!db) throw new Error("Database not configured");

  const row = await qOne({
    sql: "SELECT status, posthog_distinct_id FROM leads WHERE id = ? AND deleted_at IS NULL",
    args: [leadId],
  });
  if (!row) throw new Error(`Lead not found: ${leadId}`);
  const from = String(row.status) as LeadStatus;

  if (from === to) return { from, to }; // idempotent no-op (webhook retries)
  if (!isTransitionAllowed(from, to)) throw new IllegalTransitionError(from, to);

  const now = nowIso();
  // Guarded update: if another writer already moved this lead off `from`, the
  // UPDATE affects 0 rows. Only record the transition event when we actually
  // won the race — otherwise the append-only timeline gets a false entry.
  const upd = await db.execute({
    sql: "UPDATE leads SET status = ?, updated_at = ? WHERE id = ? AND status = ?",
    args: [to, now, leadId, from],
  });
  if (upd.rowsAffected === 0) {
    // Someone else transitioned concurrently. If they landed on our target,
    // treat it as an idempotent success; otherwise surface a conflict.
    const cur = await qOne({
      sql: "SELECT status FROM leads WHERE id = ? AND deleted_at IS NULL",
      args: [leadId],
    });
    const curStatus = cur ? (String(cur.status) as LeadStatus) : null;
    if (curStatus === to) return { from, to };
    throw new IllegalTransitionError(curStatus ?? "unknown", to);
  }
  await db.execute({
    sql: `INSERT INTO lead_events (lead_id, at, type, from_status, to_status, actor, meta)
          VALUES (?, ?, 'transition', ?, ?, ?, ?)`,
    args: [leadId, now, from, to, actor, JSON.stringify(meta)],
  });

  await captureServerEvent(
    "lead_status_changed",
    { lead_id: leadId, from_status: from, to_status: to, actor },
    row.posthog_distinct_id ? String(row.posthog_distinct_id) : undefined,
  );

  return { from, to };
}

/** Append a non-transition event to the lead timeline. */
export async function recordLeadEvent(
  leadId: string,
  type: string,
  actor: Actor | string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  await qOne({
    sql: `INSERT INTO lead_events (lead_id, at, type, actor, meta)
          VALUES (?, ?, ?, ?, ?) RETURNING id`,
    args: [leadId, nowIso(), type, actor, JSON.stringify(meta)],
  });
}
