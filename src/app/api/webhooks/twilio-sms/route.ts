import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb, q, nowIso } from "@/lib/db";
import { getLeadByPhone } from "@/lib/leads";
import { toE164US } from "@/lib/phone";
import { revokeConsent } from "@/lib/compliance/consent";
import { transition } from "@/lib/lead-machine";

/**
 * POST /api/webhooks/twilio-sms — inbound SMS (form-encoded).
 *
 * Validates X-Twilio-Signature by hand: HMAC-SHA1 over the full request URL
 * plus the POST params sorted by key and concatenated key+value, keyed with
 * TWILIO_AUTH_TOKEN, base64, compared timing-safe. Unset token ⇒ 503 in
 * production, accept-without-verify in dev (with a loud warning).
 *
 * Every inbound message is deduped on MessageSid and recorded in the
 * messages ledger. STOP words (and fuzzy revocation phrases) run the full
 * revokeConsent pipeline with channel 'all' — the safest reading of the FCC
 * revocation rules. HELP gets the static TwiML reply; any other reply from a
 * lead in 'contacting' counts as engagement.
 */

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const FUZZY_STOP = ["stop calling", "stop texting", "remove me"];

function xml(body: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/xml" } });
}

function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(rawBody);
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    if (process.env.NODE_ENV === "production") {
      return Response.json({ error: "Twilio auth token not configured" }, { status: 503 });
    }
    console.warn(
      "[twilio-sms webhook] TWILIO_AUTH_TOKEN unset — accepting WITHOUT verification (dev only)",
    );
  } else {
    const signature = (request.headers.get("x-twilio-signature") ?? "").slice(0, 256);
    const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    let signed = request.url;
    for (const [key, value] of sorted) signed += key + value;
    const expected = createHmac("sha1", authToken).update(signed).digest("base64");
    if (!signature || !timingSafeEq(signature, expected)) {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const fromRaw = (params.get("From") ?? "").slice(0, 32);
  const from = toE164US(fromRaw) ?? fromRaw;
  const body = (params.get("Body") ?? "").slice(0, 1600);
  const messageSid = (params.get("MessageSid") ?? "").slice(0, 64);

  // Dedupe on MessageSid (Twilio retries on slow/failed responses).
  const db = await getDb();
  let dedupeClaimed = false;
  if (db && messageSid) {
    const inserted = await db.execute({
      sql: "INSERT OR IGNORE INTO webhook_events (provider, event_id, received_at) VALUES ('twilio', ?, ?)",
      args: [messageSid, nowIso()],
    });
    if (inserted.rowsAffected === 0) return xml("<Response/>");
    dedupeClaimed = true;
  }

  // If anything below throws (e.g. revokeConsent), release the dedupe claim so
  // Twilio's retry re-processes — an unreleased claim would silently drop a STOP.
  try {
    return await handleMessage();
  } catch (err) {
    if (db && dedupeClaimed && messageSid) {
      await db
        .execute({
          sql: "DELETE FROM webhook_events WHERE provider = 'twilio' AND event_id = ?",
          args: [messageSid],
        })
        .catch(() => {});
    }
    console.error("[twilio-sms webhook] processing failed:", err);
    return Response.json({ error: "processing failed" }, { status: 500 });
  }

  async function handleMessage(): Promise<Response> {
  const lead = from ? await getLeadByPhone(from) : null;
  const leadId = lead ? String(lead.id) : null;

  // Ledger the inbound message (to_addr holds the counterparty, matching the
  // privacy-deletion sweep's assumption that to_addr is the lead's PII).
  await q({
    sql: `INSERT INTO messages (id, lead_id, job_id, channel, direction, kind, template, to_addr, subject, body, status, created_at)
          VALUES (?, ?, NULL, 'sms', 'inbound', 'transactional', '', ?, '', ?, 'received', ?)`,
    args: [crypto.randomUUID(), leadId, from, body, nowIso()],
  });

  const normalized = body.trim().toUpperCase();
  const lower = body.toLowerCase();
  const isStop = STOP_WORDS.has(normalized) || FUZZY_STOP.some((p) => lower.includes(p));

  if (isStop) {
    // Channel 'all' is the safest reading — a texted "stop" kills every channel.
    await revokeConsent({
      leadId,
      phoneE164: from || null,
      channel: "all",
      source: "sms_stop",
      evidence: body,
    });
    return xml("<Response/>");
  }

  if (normalized === "HELP") {
    const helpAddr = process.env.EMAIL_REPLY_TO || "iamfarzaad@gmail.com";
    return xml(
      `<Response><Message>VentWash hood cleaning. For help email ${helpAddr}. Reply STOP to opt out.</Message></Response>`,
    );
  }

  // Any other reply from a lead we were cold-contacting is engagement.
  if (leadId && String(lead!.status) === "contacting") {
    try {
      await transition(leadId, "engaged", "customer", { via: "sms_reply" });
    } catch {
      /* illegal edge or race — the message ledger row is enough */
    }
  }

  return xml("<Response/>");
  }
}
