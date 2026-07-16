import { getDb, qOne, nowIso } from "@/lib/db";
import { cancelJobsForLead } from "@/lib/jobs";
import { writeAudit, raiseAlert } from "@/lib/compliance/audit";
import { captureServerEvent } from "@/lib/posthog-server";

/**
 * Consent lifecycle. Tiers only move UP through recordConsent() (with the
 * verbatim disclosure text preserved as evidence) and to 'none' through
 * revokeConsent(). Both tables are append-only.
 *
 * revokeConsent implements the FCC revocation rules: honored immediately,
 * by any reasonable means, and executes as one atomic write — tier reset,
 * DNC/suppression inserts, status → do_not_contact, queued-job cancellation.
 */

export type ConsentTier = "none" | "express" | "express_written";
export type ConsentChannel = "all" | "voice" | "sms" | "email";

const TIER_RANK: Record<ConsentTier, number> = { none: 0, express: 1, express_written: 2 };

export interface ConsentCapture {
  leadId: string;
  tier: Exclude<ConsentTier, "none">;
  channelScope?: ConsentChannel;
  source: "quote_form" | "inbound_call" | "onboarding_form" | "manual_documented";
  ip?: string | null;
  formUrl?: string | null;
  /** The exact disclosure/checkbox language rendered at capture time. Required. */
  disclosureText: string;
  rawPayload?: Record<string, unknown>;
}

export async function recordConsent(c: ConsentCapture): Promise<void> {
  const db = await getDb();
  if (!db) return;
  if (!c.disclosureText.trim()) {
    throw new Error("recordConsent requires the verbatim disclosure text");
  }
  const now = nowIso();

  const lead = await qOne({
    sql: "SELECT consent_tier, posthog_distinct_id FROM leads WHERE id = ? AND deleted_at IS NULL",
    args: [c.leadId],
  });
  if (!lead) throw new Error(`Lead not found: ${c.leadId}`);

  const currentTier = String(lead.consent_tier) as ConsentTier;

  // A prior opt-out is honored indefinitely. If this contact previously
  // revoked, DON'T raise the tier back up — that would make the lead look
  // contactable ('express') while every channel is still blocked by the
  // revocation, producing silent send failures. Record the consent event as
  // evidence and flag it for a human to reconcile (genuine re-opt-in must be
  // handled deliberately, e.g. by removing the internal-DNC entry).
  const priorRevocation = await qOne({
    sql: `SELECT id FROM revocations
          WHERE (lead_id IS NOT NULL AND lead_id = ?)
             OR (phone_e164 IS NOT NULL AND phone_e164 = (SELECT phone_e164 FROM leads WHERE id = ?))
          LIMIT 1`,
    args: [c.leadId, c.leadId],
  });
  const upgrade = !priorRevocation && TIER_RANK[c.tier] > TIER_RANK[currentTier];

  const stmts = [
    {
      sql: `INSERT INTO consent_events (lead_id, tier, channel_scope, captured_at, source, ip, form_url, disclosure_text, raw_payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        c.leadId, c.tier, c.channelScope ?? "all", now, c.source,
        c.ip ?? null, c.formUrl ?? null, c.disclosureText,
        JSON.stringify(c.rawPayload ?? {}),
      ],
    },
    {
      sql: `INSERT INTO lead_events (lead_id, at, type, actor, meta)
            VALUES (?, ?, 'consent', 'customer', ?)`,
      args: [c.leadId, now, JSON.stringify({ tier: c.tier, source: c.source })],
    },
  ];
  if (upgrade) {
    stmts.push({
      sql: "UPDATE leads SET consent_tier = ?, updated_at = ? WHERE id = ?",
      args: [c.tier, now, c.leadId],
    });
  }
  await db.batch(stmts, "write");

  if (priorRevocation) {
    await raiseAlert(
      "warn",
      "consent_after_revocation",
      `Lead ${c.leadId} submitted new consent (${c.tier}) but has a prior opt-out; tier left unchanged pending manual review.`,
      { leadId: c.leadId, source: c.source },
    );
  }

  await captureServerEvent(
    "consent_recorded",
    { lead_id: c.leadId, tier: c.tier, source: c.source, honored: !priorRevocation },
    lead.posthog_distinct_id ? String(lead.posthog_distinct_id) : undefined,
  );
}

/** Latest consent event of the required tier within `withinDays`, or null. */
export async function latestConsentEvent(
  leadId: string,
  withinDays?: number,
): Promise<{ tier: ConsentTier; captured_at: string } | null> {
  const row = await qOne({
    sql: `SELECT tier, captured_at FROM consent_events
          WHERE lead_id = ? ORDER BY captured_at DESC LIMIT 1`,
    args: [leadId],
  });
  if (!row) return null;
  const capturedAt = String(row.captured_at);
  if (withinDays !== undefined) {
    const ageMs = Date.now() - new Date(capturedAt).getTime();
    if (!(ageMs <= withinDays * 24 * 60 * 60 * 1000)) return null;
  }
  return { tier: String(row.tier) as ConsentTier, captured_at: capturedAt };
}

/** Has this contact revoked for the channel (or 'all')? Checks lead id, phone and email. */
export async function isRevoked(
  lead: { id?: string | null; phone_e164?: string | null; email?: string | null },
  channel: Exclude<ConsentChannel, "all">,
): Promise<boolean> {
  const row = await qOne({
    sql: `SELECT id FROM revocations
          WHERE channel IN (?, 'all')
            AND ((lead_id IS NOT NULL AND lead_id = ?)
              OR (phone_e164 IS NOT NULL AND phone_e164 = ?)
              OR (email IS NOT NULL AND email = ?))
          LIMIT 1`,
    args: [channel, lead.id ?? "", lead.phone_e164 ?? "", (lead.email ?? "").toLowerCase()],
  });
  return row !== null;
}

export interface Revocation {
  leadId?: string | null;
  phoneE164?: string | null;
  email?: string | null;
  channel?: ConsentChannel;
  source: "sms_stop" | "voice_request" | "email_unsubscribe" | "admin" | "complaint";
  /** Verbatim message / transcript excerpt / URL proving the request. */
  evidence: string;
  actor?: string;
}

/**
 * Honor an opt-out immediately. One atomic batch: append revocation, reset
 * tier, insert DNC/suppression, move the lead to do_not_contact with a
 * timeline row — then cancel every queued job for the lead.
 */
export async function revokeConsent(r: Revocation): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const now = nowIso();
  const channel = r.channel ?? "all";
  const email = r.email ? r.email.trim().toLowerCase() : null;

  // Resolve the lead if we only got a phone/email.
  let leadId = r.leadId ?? null;
  if (!leadId && (r.phoneE164 || email)) {
    const row = await qOne({
      sql: `SELECT id FROM leads WHERE deleted_at IS NULL
              AND ((? IS NOT NULL AND phone_e164 = ?) OR (? IS NOT NULL AND email = ?))
            ORDER BY created_at DESC LIMIT 1`,
      args: [r.phoneE164 ?? null, r.phoneE164 ?? "", email, email ?? ""],
    });
    if (row) leadId = String(row.id);
  }

  const stmts = [
    {
      sql: `INSERT INTO revocations (lead_id, phone_e164, email, channel, source, evidence, revoked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [leadId, r.phoneE164 ?? null, email, channel, r.source, r.evidence.slice(0, 2000), now],
    },
  ];
  if (r.phoneE164 && (channel === "all" || channel === "voice" || channel === "sms")) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO dnc_internal (phone_e164, reason, added_by, added_at)
            VALUES (?, ?, ?, ?)`,
      args: [r.phoneE164, r.source === "sms_stop" ? "sms_stop" : "requested_on_call", r.actor ?? "system", now],
    });
  }
  if (email && (channel === "all" || channel === "email")) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO email_suppressions (email, reason, source, added_at)
            VALUES (?, 'unsubscribe', ?, ?)`,
      args: [email, r.source === "email_unsubscribe" ? "link" : "admin", now],
    });
  }
  if (leadId && channel === "all") {
    stmts.push(
      {
        sql: `UPDATE leads SET consent_tier = 'none', status = 'do_not_contact', updated_at = ?
              WHERE id = ? AND status != 'do_not_contact'`,
        args: [now, leadId],
      },
      {
        sql: `INSERT INTO lead_events (lead_id, at, type, to_status, actor, meta)
              VALUES (?, ?, 'revocation', 'do_not_contact', ?, ?)`,
        args: [leadId, now, r.actor ?? "customer", JSON.stringify({ channel, source: r.source })],
      },
    );
  } else if (leadId) {
    stmts.push(
      {
        sql: "UPDATE leads SET consent_tier = 'none', updated_at = ? WHERE id = ?",
        args: [now, leadId],
      },
      {
        sql: `INSERT INTO lead_events (lead_id, at, type, actor, meta)
              VALUES (?, ?, 'revocation', ?, ?)`,
        args: [leadId, now, r.actor ?? "customer", JSON.stringify({ channel, source: r.source })],
      },
    );
  }

  await db.batch(stmts, "write");

  if (leadId && channel === "all") await cancelJobsForLead(leadId);

  await writeAudit({
    actor: r.actor ?? "customer",
    action: "consent_revoked",
    leadId,
    channel,
    meta: { source: r.source },
  });
  await captureServerEvent("consent_revoked", {
    lead_id: leadId ?? "unknown",
    channel,
    source: r.source,
  });
}
