import { q, qOne, getSetting, nowIso } from "@/lib/db";
import { writeAudit } from "@/lib/compliance/audit";

/**
 * Do-Not-Call scrubbing: internal list (write-once, honored forever) and the
 * national registry mirror (dnc_national, synced weekly from an FTC SAN
 * subscription by the dnc_sync job).
 *
 * There is deliberately NO removeInternalDnc function and no DELETE endpoint —
 * removals require direct DB access with a logged reason (spec D12).
 */

export const DNC_MAX_AGE_DAYS = 31;

export async function isInternalDnc(phoneE164: string): Promise<boolean> {
  const row = await qOne({
    sql: "SELECT phone_e164 FROM dnc_internal WHERE phone_e164 = ?",
    args: [phoneE164],
  });
  return row !== null;
}

export async function addInternalDnc(
  phoneE164: string,
  reason: "requested_on_call" | "sms_stop" | "admin" | "complaint" | "deletion_request",
  addedBy: string,
): Promise<void> {
  await q({
    sql: "INSERT OR IGNORE INTO dnc_internal (phone_e164, reason, added_by, added_at) VALUES (?, ?, ?, ?)",
    args: [phoneE164, reason, addedBy, nowIso()],
  });
  await writeAudit({ actor: addedBy, action: "dnc_added", channel: "voice", meta: { reason } });
}

export async function isNationalDnc(phoneE164: string): Promise<boolean> {
  const row = await qOne({
    sql: "SELECT phone_e164 FROM dnc_national WHERE phone_e164 = ?",
    args: [phoneE164],
  });
  return row !== null;
}

export interface DncFreshness {
  syncedAt: string | null;
  ageDays: number | null;
  fresh: boolean;
}

/** National registry data freshness. Never synced ⇒ not fresh (fail closed). */
export async function dncFreshness(): Promise<DncFreshness> {
  const syncedAt = await getSetting("dnc_synced_at");
  if (!syncedAt) return { syncedAt: null, ageDays: null, fresh: false };
  const ageMs = Date.now() - new Date(syncedAt).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return { syncedAt, ageDays, fresh: Number.isFinite(ageDays) && ageDays <= DNC_MAX_AGE_DAYS };
}
