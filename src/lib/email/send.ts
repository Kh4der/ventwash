import { getDb, qOne, nowIso } from "@/lib/db";
import { isChannelEnabled } from "@/lib/flags";
import { isRevoked } from "@/lib/compliance/consent";
import { writeAudit } from "@/lib/compliance/audit";

/**
 * THE email choke point — the only code that talks to Resend. Compliance
 * gates run BEFORE the configured/unconfigured check: a blocked email is
 * recorded as 'blocked', an unconfigured send as 'skipped_unconfigured'
 * (dev no-op, pipeline still testable offline). Every outcome is a
 * `messages` row.
 *
 * Cold email (kind 'cold') additionally requires: email_cold flag, founder
 * approval on the lead, a provenanced contact_points row for the EXACT
 * address, the daily cap, the outreach-subdomain sender, and the CAN-SPAM
 * partials (postal address + unsubscribe link) present in the rendered HTML —
 * asserted at runtime here, in addition to the template-level enforcement.
 */

export interface OutgoingEmail {
  leadId?: string | null;
  jobId?: string | null;
  kind: "transactional" | "cold" | "internal";
  template: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: { filename: string; content: string }[]; // content = base64
}

export interface SendResult {
  messageId: string;
  status: "sent" | "blocked" | "skipped_unconfigured";
  blockReason?: string;
}

/** Markers the cold template partials must render — checked at runtime. */
export const CANSPAM_MARKERS = {
  unsubscribe: "/api/unsubscribe?token=",
  postalAttr: 'data-vw-postal="1"',
};

async function record(
  email: OutgoingEmail,
  status: string,
  extra: { blockReason?: string; providerId?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const db = await getDb();
  if (!db) return id;
  await db.execute({
    sql: `INSERT INTO messages (id, lead_id, job_id, channel, direction, kind, template, to_addr, subject, body, status, block_reason, provider_id, sent_at, created_at)
          VALUES (?, ?, ?, 'email', 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, email.leadId ?? null, email.jobId ?? null, email.kind, email.template,
      email.to, email.subject, email.html, status, extra.blockReason ?? null,
      extra.providerId ?? null, status === "sent" ? nowIso() : null, nowIso(),
    ],
  });
  return id;
}

async function block(email: OutgoingEmail, reason: string): Promise<SendResult> {
  const messageId = await record(email, "blocked", { blockReason: reason });
  await writeAudit({
    actor: "system", action: "email_blocked", leadId: email.leadId,
    channel: "email", meta: { reason, template: email.template, kind: email.kind },
  });
  return { messageId, status: "blocked", blockReason: reason };
}

export async function sendEmail(email: OutgoingEmail): Promise<SendResult> {
  const to = email.to.trim().toLowerCase();

  // ── Compliance gates (always run, even unconfigured) ──────────────────
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return block(email, "invalid_address");
  }

  if (email.kind !== "internal") {
    const suppressed = await qOne({
      sql: "SELECT email FROM email_suppressions WHERE email = ?",
      args: [to],
    });
    if (suppressed) return block(email, "suppressed");
    if (await isRevoked({ id: email.leadId ?? null, email: to }, "email")) {
      return block(email, "revoked");
    }
  }

  if (email.kind === "transactional" && !(await isChannelEnabled("email_transactional"))) {
    return block(email, "channel_disabled");
  }

  let from = process.env.EMAIL_FROM || "VentWash <onboarding@resend.dev>";

  if (email.kind === "cold") {
    if (!(await isChannelEnabled("email_cold"))) return block(email, "channel_disabled");
    if (!email.leadId) return block(email, "cold_requires_lead");

    const lead = await qOne({
      sql: "SELECT approval, status FROM leads WHERE id = ? AND deleted_at IS NULL",
      args: [email.leadId],
    });
    if (!lead) return block(email, "lead_missing");
    if (String(lead.approval) !== "approved") return block(email, "not_approved");

    // Provenance: the exact address must have a source_url on record.
    const provenance = await qOne({
      sql: "SELECT source_url FROM contact_points WHERE lead_id = ? AND kind = 'email' AND value = ?",
      args: [email.leadId, to],
    });
    if (!provenance) return block(email, "no_provenance");

    // CAN-SPAM partials must be present in the rendered HTML.
    if (
      !email.html.includes(CANSPAM_MARKERS.unsubscribe) ||
      !email.html.includes(CANSPAM_MARKERS.postalAttr)
    ) {
      return block(email, "missing_canspam_partials");
    }

    // Daily cap — atomic upsert counter; over-counting blocks is the safe direction.
    const cap = Number(process.env.MAX_COLD_EMAILS_PER_DAY || 50);
    const day = nowIso().slice(0, 10);
    const db = await getDb();
    if (!db) return block(email, "db_unconfigured");
    const res = await db.execute({
      sql: `INSERT INTO settings (key, value) VALUES (?, '1')
            ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
            RETURNING value`,
      args: ["daily_cold_email_count:" + day],
    });
    const count = Number(res.rows[0]?.value ?? 1);
    if (count > cap) return block(email, "daily_cold_cap");

    const coldFrom = process.env.COLD_EMAIL_FROM;
    if (!coldFrom) return block(email, "cold_sender_unconfigured");
    from = coldFrom;
  }

  // ── Provider ──────────────────────────────────────────────────────────
  if (!process.env.RESEND_API_KEY) {
    const messageId = await record(email, "skipped_unconfigured");
    console.log(`[dev no-op] email (${email.kind}/${email.template}) to ${to}: ${email.subject}`);
    return { messageId, status: "skipped_unconfigured" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: email.replyTo || process.env.EMAIL_REPLY_TO || undefined,
      subject: email.subject,
      html: email.html,
      attachments: email.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    }),
  });

  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    await record(email, "failed", { blockReason: "provider_error: " + text });
    throw new Error(`Resend send failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id?: string };
  const messageId = await record(email, "sent", { providerId: data.id });
  await writeAudit({
    actor: "system", action: "email_sent", leadId: email.leadId, channel: "email",
    payload: email.html, meta: { template: email.template, kind: email.kind, providerId: data.id },
  });
  return { messageId, status: "sent" };
}
