import { q, qOne, nowIso } from "@/lib/db";
import { writeAudit } from "@/lib/compliance/audit";

/**
 * Channel kill switches. All rows are seeded 0 (off) by migration 0001 and
 * can only be enabled from the admin dashboard. When the database is
 * unavailable (getDb() === null) every flag reads as OFF — a missing flags
 * table must never mean "on".
 */

export type Channel =
  | "voice_outbound_ai"
  | "voice_outbound_bridge"
  | "sms"
  | "email_transactional"
  | "email_cold"
  | "crawler"
  | "discovery";

export async function isChannelEnabled(channel: Channel): Promise<boolean> {
  const row = await qOne({
    sql: "SELECT enabled FROM channel_flags WHERE channel = ?",
    args: [channel],
  });
  return row ? Number(row.enabled) === 1 : false;
}

export async function listChannelFlags(): Promise<
  { channel: string; enabled: boolean; updated_by: string | null; updated_at: string | null }[]
> {
  const rows = await q("SELECT channel, enabled, updated_by, updated_at FROM channel_flags ORDER BY channel");
  return rows.map((r) => ({
    channel: String(r.channel),
    enabled: Number(r.enabled) === 1,
    updated_by: r.updated_by ? String(r.updated_by) : null,
    updated_at: r.updated_at ? String(r.updated_at) : null,
  }));
}

export async function setChannelFlag(
  channel: Channel,
  enabled: boolean,
  updatedBy: string,
): Promise<void> {
  await q({
    sql: "UPDATE channel_flags SET enabled = ?, updated_by = ?, updated_at = ? WHERE channel = ?",
    args: [enabled ? 1 : 0, updatedBy, nowIso(), channel],
  });
  await writeAudit({
    actor: updatedBy,
    action: "flag_toggled",
    channel,
    meta: { enabled },
  });
}

/**
 * Auto-pause a channel in response to a compliance signal (e.g. disclosure
 * assertion failure, repeated conduct flags). Records who/why in the audit log.
 */
export async function autoPauseChannel(channel: Channel, reason: string): Promise<void> {
  await q({
    sql: "UPDATE channel_flags SET enabled = 0, updated_by = 'system:auto_pause', updated_at = ? WHERE channel = ?",
    args: [nowIso(), channel],
  });
  await writeAudit({
    actor: "system",
    action: "flag_auto_paused",
    channel,
    meta: { reason },
  });
}
