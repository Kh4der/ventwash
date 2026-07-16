import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb, nowIso } from "@/lib/db";
import { writeAudit } from "@/lib/compliance/audit";
import type { LeadForCall } from "@/lib/compliance/tcpa";
import { siteBaseUrl } from "@/lib/link-tokens";

/**
 * Founder click-to-dial bridge — the ONLY system-mediated path to a cold
 * (tier 'none') lead's phone. Twilio calls the FOUNDER's phone first; when
 * they answer, TwiML bridges the second leg to the lead. A human speaks —
 * no AI, no prerecorded audio, recording off.
 *
 * Only reachable through POST /api/admin/leads/[id]/bridge AFTER
 * canPlaceBridgeCall passed. The caller ID is OUTBOUND_CALLER_ID with no
 * per-call override (Truth in Caller ID).
 */

function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.OUTBOUND_CALLER_ID &&
      process.env.FOUNDER_PHONE,
  );
}

/** Bridge signing key. FAIL CLOSED: no real secret ⇒ tokens can't be made. */
function bridgeSecret(): string | null {
  return process.env.TWILIO_AUTH_TOKEN || process.env.SESSION_SECRET || null;
}

/**
 * HMAC over leadId + attemptId + expiry for the TwiML callback URL. Binding the
 * attempt id stops one signed link from mutating a different call_attempts row;
 * the expiry bounds replay. Returns null when no secret is configured (the
 * caller then can't place a bridge — correct fail-closed behavior).
 */
export function signBridgeParam(leadId: string, attemptId: string, exp: number): string | null {
  const secret = bridgeSecret();
  if (!secret) return null;
  return createHmac("sha256", "vw-bridge:" + secret)
    .update(`${leadId}:${attemptId}:${exp}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyBridgeParam(
  leadId: string,
  attemptId: string,
  exp: string | null,
  sig: string | null,
): boolean {
  if (!sig || !exp) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || Date.now() > expNum) return false;
  const expected = signBridgeParam(leadId, attemptId, expNum);
  if (!expected) return false;
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Bridge callback links live for 2h — long enough for a slow-answered long call. */
const BRIDGE_TTL_MS = 2 * 60 * 60 * 1000;

export interface BridgeResult {
  callAttemptId: string;
  simulated: boolean;
}

export async function placeBridgeCall(lead: LeadForCall, foundedBy: string): Promise<BridgeResult | null> {
  const db = await getDb();
  if (!db) return null;
  const id = crypto.randomUUID();
  const now = nowIso();
  const simulated = !twilioConfigured();

  await db.batch(
    [
      {
        sql: `INSERT INTO call_attempts (
                id, lead_id, direction, mode, purpose, consent_tier_snapshot,
                line_type_snapshot, dnc_exception_basis, status, created_at
              ) VALUES (?, ?, 'outbound', 'human_bridge', 'cold_intro', ?, ?, NULL, 'queued', ?)`,
        args: [id, lead.id, lead.consent_tier, lead.phone_line_type, now],
      },
      {
        sql: "UPDATE leads SET call_attempt_count = call_attempt_count + 1, last_call_at = ?, updated_at = ? WHERE id = ?",
        args: [now, now, lead.id],
      },
      {
        sql: `INSERT INTO lead_events (lead_id, at, type, actor, meta)
              VALUES (?, ?, 'call_attempt', ?, ?)`,
        args: [lead.id, now, foundedBy, JSON.stringify({ mode: "human_bridge", simulated })],
      },
    ],
    "write",
  );

  if (simulated) {
    await db.execute({
      sql: "UPDATE call_attempts SET status = 'completed', summary = '[dev no-op] Twilio unconfigured — bridge simulated', ended_at = ?, duration_s = 0 WHERE id = ?",
      args: [nowIso(), id],
    });
    console.log(`[dev no-op] bridge call founder→${lead.phone_e164} — Twilio not configured`);
    await writeAudit({
      actor: foundedBy, action: "bridge_placed", leadId: lead.id, channel: "voice_bridge",
      consentTier: lead.consent_tier, meta: { simulated: true },
    });
    return { callAttemptId: id, simulated: true };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(sid + ":" + process.env.TWILIO_AUTH_TOKEN).toString("base64");
  const exp = Date.now() + BRIDGE_TTL_MS;
  const sig = signBridgeParam(lead.id, id, exp);
  if (!sig) {
    await db.execute({
      sql: "UPDATE call_attempts SET status = 'failed', summary = 'bridge signing secret unconfigured' WHERE id = ?",
      args: [id],
    });
    throw new Error("Bridge signing secret (TWILIO_AUTH_TOKEN/SESSION_SECRET) not configured");
  }
  const cbBase =
    siteBaseUrl() +
    `/api/webhooks/twilio-voice?leadId=${encodeURIComponent(lead.id)}&attempt=${id}&exp=${exp}&sig=${sig}`;

  const body = new URLSearchParams({
    To: process.env.FOUNDER_PHONE!,
    From: process.env.OUTBOUND_CALLER_ID!,
    Url: cbBase,
    // Without StatusCallback Twilio never delivers terminal call status, so
    // the webhook's TERMINAL_STATUS branch would never run and call_attempts
    // would be stuck at 'ringing'.
    StatusCallback: cbBase,
    StatusCallbackEvent: "completed",
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + auth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );

  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    await db.execute({
      sql: "UPDATE call_attempts SET status = 'failed', summary = ? WHERE id = ?",
      args: ["Twilio bridge failed: " + text, id],
    });
    throw new Error(`Twilio bridge failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { sid?: string };
  await db.execute({
    sql: "UPDATE call_attempts SET twilio_call_sid = ?, status = 'ringing' WHERE id = ?",
    args: [data.sid ?? null, id],
  });
  await writeAudit({
    actor: foundedBy, action: "bridge_placed", leadId: lead.id, channel: "voice_bridge",
    consentTier: lead.consent_tier, meta: { twilioSid: data.sid },
  });
  return { callAttemptId: id, simulated: false };
}
