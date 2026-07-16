import { q, qOne, nowIso } from "@/lib/db";
import { verifyBridgeParam } from "@/lib/voice/bridge";

/**
 * /api/webhooks/twilio-voice — TwiML + status callbacks for the founder
 * click-to-dial bridge (the ONLY system-mediated path to a cold lead's phone).
 *
 * Twilio first calls the FOUNDER; when they answer it fetches this URL
 * (?leadId&sig&attempt, HMAC-signed by bridge.ts) and we return TwiML that
 * dials the LEAD as the second leg. A human speaks on the line — no AI, no
 * prerecorded audio, and deliberately NO <Record>: recording stays off on
 * bridges. Caller ID is the hard-coded OUTBOUND_CALLER_ID (Truth in Caller ID).
 *
 * Terminal status callbacks (CallStatus completed/no-answer/busy/failed/
 * canceled) update the call_attempts row and get an empty <Response/>.
 */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xml(body: string, status = 200): Response {
  return new Response(XML_HEADER + body, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

/** Twilio terminal CallStatus → call_attempts.status. */
const TERMINAL_STATUS: Record<string, string> = {
  "completed": "completed",
  "no-answer": "no_answer",
  "busy": "failed",
  "failed": "failed",
  "canceled": "failed",
};

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const leadId = url.searchParams.get("leadId") ?? "";
  const sig = url.searchParams.get("sig");
  const attemptId = url.searchParams.get("attempt") ?? "";
  const exp = url.searchParams.get("exp");

  // Twilio sends form-encoded params on POST; tolerate anything else.
  const params = new Map<string, string>();
  if (request.method === "POST") {
    try {
      const form = await request.formData();
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") params.set(k, v.slice(0, 500));
      }
    } catch {
      /* no/invalid body — fall through to query-only handling */
    }
  }
  const callStatus = (params.get("CallStatus") ?? url.searchParams.get("CallStatus") ?? "")
    .toLowerCase();

  // The callback URL carries the signed leadId+attempt+exp either way — verify first.
  if (!verifyBridgeParam(leadId, attemptId, exp, sig)) {
    return new Response("Forbidden", { status: 403 });
  }

  // ── status callback: record the outcome, say nothing back ──
  if (callStatus in TERMINAL_STATUS) {
    const status = TERMINAL_STATUS[callStatus];
    const durationRaw = Number(params.get("CallDuration") ?? "");
    const durationS = Number.isFinite(durationRaw) ? Math.round(durationRaw) : null;
    const callSid = params.get("CallSid") ?? "";
    const now = nowIso();
    if (attemptId) {
      await q({
        sql: `UPDATE call_attempts SET status = ?, duration_s = COALESCE(?, duration_s),
                ended_at = ?, twilio_call_sid = COALESCE(twilio_call_sid, ?)
              WHERE id = ?`,
        args: [status, durationS, now, callSid || null, attemptId],
      });
    } else if (callSid) {
      await q({
        sql: `UPDATE call_attempts SET status = ?, duration_s = COALESCE(?, duration_s), ended_at = ?
              WHERE twilio_call_sid = ?`,
        args: [status, durationS, now, callSid],
      });
    }
    return xml("<Response/>");
  }

  // ── TwiML fetch: founder answered — bridge the second leg to the lead ──
  const lead = await qOne({
    sql: "SELECT phone_e164 FROM leads WHERE id = ? AND deleted_at IS NULL",
    args: [leadId],
  });
  const leadPhone = lead?.phone_e164 ? String(lead.phone_e164) : null;
  const callerId = process.env.OUTBOUND_CALLER_ID ?? "";

  if (!leadPhone || !callerId) {
    // Nothing dialable (lead deleted mid-flight / env missing) — hang up.
    if (attemptId) {
      await q({
        sql: "UPDATE call_attempts SET status = 'failed', ended_at = ? WHERE id = ?",
        args: [nowIso(), attemptId],
      });
    }
    return xml("<Response><Hangup/></Response>");
  }

  if (attemptId) {
    await q({
      sql: `UPDATE call_attempts SET status = 'in_progress'
            WHERE id = ? AND status IN ('queued', 'ringing')`,
      args: [attemptId],
    });
  }

  // NO <Record> here — recording stays off on human bridges (spec D21).
  return xml(
    `<Response><Dial callerId="${xmlEscape(callerId)}">` +
      `<Number>${xmlEscape(leadPhone)}</Number>` +
      `</Dial></Response>`,
  );
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
