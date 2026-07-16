import { getDb, qOne, nowIso } from "@/lib/db";
import { isChannelEnabled } from "@/lib/flags";
import { isRevoked } from "@/lib/compliance/consent";
import { isInternalDnc } from "@/lib/compliance/dnc";
import { checkQuietHours } from "@/lib/compliance/quiet-hours";
import { writeAudit } from "@/lib/compliance/audit";

/**
 * THE SMS choke point — the only code that sends through Twilio Messages.
 * Scraped numbers are structurally unreachable: 'transactional' requires a
 * consent event on record plus an active engagement/booking, 'marketing'
 * requires express_written consent scoped to SMS. Every outcome is a
 * `messages` row; the first message to a number carries the STOP notice.
 *
 * Launch gates outside this code: A2P 10DLC registration BEFORE setting
 * SMS_ENABLED=1 (runbook item — carrier filtering and fines otherwise).
 */

export interface OutgoingSms {
  leadId: string;
  jobId?: string | null;
  kind: "transactional" | "marketing";
  template: string;
  to: string; // E.164
  body: string;
}

export interface SmsResult {
  messageId: string;
  status: "sent" | "blocked" | "skipped_unconfigured";
  blockReason?: string;
}

const TRANSACTIONAL_STATUSES = new Set([
  "engaged",
  "appointment_scheduled",
  "won_pending_onboarding",
  "onboarded",
  "inspection_scheduled",
  "customer",
]);

async function record(
  sms: OutgoingSms,
  status: string,
  extra: { blockReason?: string; providerId?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const db = await getDb();
  if (!db) return id;
  await db.execute({
    sql: `INSERT INTO messages (id, lead_id, job_id, channel, direction, kind, template, to_addr, subject, body, status, block_reason, provider_id, sent_at, created_at)
          VALUES (?, ?, ?, 'sms', 'outbound', ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
    args: [
      id, sms.leadId, sms.jobId ?? null,
      sms.kind === "marketing" ? "cold" : "transactional",
      sms.template, sms.to, sms.body, status, extra.blockReason ?? null,
      extra.providerId ?? null, status === "sent" ? nowIso() : null, nowIso(),
    ],
  });
  return id;
}

async function block(sms: OutgoingSms, reason: string): Promise<SmsResult> {
  const messageId = await record(sms, "blocked", { blockReason: reason });
  await writeAudit({
    actor: "system", action: "sms_blocked", leadId: sms.leadId, channel: "sms",
    meta: { reason, template: sms.template, kind: sms.kind },
  });
  return { messageId, status: "blocked", blockReason: reason };
}

export async function sendSms(sms: OutgoingSms): Promise<SmsResult> {
  // ── Compliance gates (always run) ─────────────────────────────────────
  if (!/^\+1\d{10}$/.test(sms.to)) return block(sms, "invalid_number");
  if (!(await isChannelEnabled("sms"))) return block(sms, "channel_disabled");
  if (await isRevoked({ id: sms.leadId, phone_e164: sms.to }, "sms")) {
    return block(sms, "revoked");
  }
  if (await isInternalDnc(sms.to)) return block(sms, "dnc_internal");

  const lead = await qOne({
    sql: "SELECT status, consent_tier, timezone, region FROM leads WHERE id = ? AND deleted_at IS NULL",
    args: [sms.leadId],
  });
  if (!lead) return block(sms, "lead_missing");

  if (sms.kind === "transactional") {
    if (!TRANSACTIONAL_STATUSES.has(String(lead.status))) {
      return block(sms, "not_engaged");
    }
    const consent = await qOne({
      sql: "SELECT id FROM consent_events WHERE lead_id = ? LIMIT 1",
      args: [sms.leadId],
    });
    if (!consent) return block(sms, "no_consent_event");
  } else {
    // marketing
    if (String(lead.consent_tier) !== "express_written") {
      return block(sms, "marketing_requires_written_consent");
    }
    const scoped = await qOne({
      sql: `SELECT id FROM consent_events WHERE lead_id = ? AND tier = 'express_written'
              AND channel_scope IN ('sms','all') LIMIT 1`,
      args: [sms.leadId],
    });
    if (!scoped) return block(sms, "consent_not_sms_scoped");
  }

  const qh = checkQuietHours({
    timezone: lead.timezone as string | null,
    region: lead.region as string | null,
  });
  if (!qh.allowed) return block(sms, "quiet_hours_" + qh.reason);

  // First message to this number carries the opt-out notice.
  const prior = await qOne({
    sql: `SELECT id FROM messages WHERE channel = 'sms' AND direction = 'outbound'
            AND to_addr = ? AND status = 'sent' LIMIT 1`,
    args: [sms.to],
  });
  let body = sms.body;
  if (!prior && !/reply stop/i.test(body)) {
    body = body.trimEnd() + " Reply STOP to opt out.";
  }
  const finalSms = { ...sms, body };

  // ── Provider ──────────────────────────────────────────────────────────
  const configured =
    process.env.SMS_ENABLED === "1" &&
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER);

  if (!configured) {
    const messageId = await record(finalSms, "skipped_unconfigured");
    console.log(`[dev no-op] sms (${sms.kind}/${sms.template}) to ${sms.to}: ${body.slice(0, 80)}`);
    return { messageId, status: "skipped_unconfigured" };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(sid + ":" + process.env.TWILIO_AUTH_TOKEN).toString("base64");
  const params = new URLSearchParams({ To: sms.to, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    params.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  } else {
    params.set("From", process.env.TWILIO_FROM_NUMBER!);
  }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + auth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    },
  );

  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    await record(finalSms, "failed", { blockReason: "provider_error: " + text });
    throw new Error(`Twilio SMS failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { sid?: string };
  const messageId = await record(finalSms, "sent", { providerId: data.sid });
  await writeAudit({
    actor: "system", action: "sms_sent", leadId: sms.leadId, channel: "sms",
    payload: body, meta: { template: sms.template, kind: sms.kind, providerId: data.sid },
  });
  return { messageId, status: "sent" };
}
