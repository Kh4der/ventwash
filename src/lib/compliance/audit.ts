import { createHash } from "node:crypto";
import { q, nowIso } from "@/lib/db";

/**
 * Append-only audit log, written from the four outbound choke points
 * (canPlaceAiCall / canPlaceBridgeCall / sendEmail / sendSms) and from
 * admin actions with legal weight (approvals, flag toggles, DNC adds,
 * deletions). There is no code path that updates or deletes audit rows,
 * and the retention sweep is required to skip this table.
 */

export interface AuditEntry {
  actor: string; // 'system' | 'cron' | 'admin' | 'vapi' | 'customer'
  action: string; // 'call_placed' | 'call_blocked' | 'email_sent' | ...
  leadId?: string | null;
  channel?: string | null;
  consentTier?: string | null;
  /** The exact rendered content sent (body/script); hashed for the record. */
  payload?: string | null;
  meta?: Record<string, unknown>;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await q({
      sql: `INSERT INTO audit_log (at, actor, action, lead_id, channel, consent_tier, payload_hash, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        nowIso(),
        entry.actor,
        entry.action,
        entry.leadId ?? null,
        entry.channel ?? null,
        entry.consentTier ?? null,
        entry.payload ? sha256(entry.payload) : null,
        JSON.stringify(entry.meta ?? {}),
      ],
    });
  } catch (err) {
    // The audit write itself must never take down a request path, but a
    // failing audit trail is an operational emergency — surface loudly.
    console.error("[audit] FAILED to write audit row:", entry.action, err);
  }
}

/** Raise an alert in the admin alert center. */
export async function raiseAlert(
  severity: "info" | "warn" | "critical",
  kind: string,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await q({
      sql: "INSERT INTO admin_alerts (at, severity, kind, message, meta) VALUES (?, ?, ?, ?, ?)",
      args: [nowIso(), severity, kind, message, JSON.stringify(meta ?? {})],
    });
  } catch (err) {
    console.error("[audit] FAILED to raise alert:", kind, err);
  }
}
