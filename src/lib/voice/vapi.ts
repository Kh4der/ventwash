import { timingSafeEqual } from "node:crypto";
import { nowIso, qOne, getDb } from "@/lib/db";
import { writeAudit } from "@/lib/compliance/audit";
import type { CallPurpose, LeadForCall } from "@/lib/compliance/tcpa";

/**
 * Vapi REST wrappers (raw fetch — no SDK). Dialing here is ONLY reachable
 * through the place-ai-call job handler AFTER canPlaceAiCall passed; this
 * module never checks compliance itself and must never be imported by
 * anything except that handler, the retention sweep, and deleteLead cascade.
 *
 * Unconfigured (no VAPI_API_KEY): dials become simulated call_attempts rows
 * (status 'completed', outcome null, cost 0) so local dev exercises the whole
 * pipeline offline. Compliance gates run BEFORE simulation — a blocked call
 * is blocked, never simulated.
 */

const VAPI_BASE = "https://api.vapi.ai";

export function vapiConfigured(): boolean {
  return Boolean(
    process.env.VAPI_API_KEY &&
      process.env.VAPI_PHONE_NUMBER_ID &&
      process.env.VAPI_ASSISTANT_OUTBOUND_ID,
  );
}

export interface DialResult {
  callAttemptId: string;
  simulated: boolean;
  vapiCallId: string | null;
}

/**
 * Create the call_attempts row (with compliance snapshots frozen at dial
 * time), then place the Vapi call. The row exists BEFORE the dial so a crash
 * mid-request still leaves an audit trail.
 */
export async function placeOutboundAiCall(
  lead: LeadForCall,
  purpose: CallPurpose,
  basis: "inquiry_ebr" | "express_written" | null,
  jobId: string | null,
): Promise<DialResult | null> {
  const db = await getDb();
  if (!db) return null;

  const id = crypto.randomUUID();
  const now = nowIso();
  const simulated = !vapiConfigured();

  await db.batch(
    [
      {
        sql: `INSERT INTO call_attempts (
                id, lead_id, direction, mode, purpose, job_id,
                consent_tier_snapshot, line_type_snapshot, dnc_exception_basis,
                status, created_at
              ) VALUES (?, ?, 'outbound', 'ai', ?, ?, ?, ?, ?, 'queued', ?)`,
        args: [
          id, lead.id, purpose, jobId,
          lead.consent_tier, lead.phone_line_type, basis, now,
        ],
      },
      {
        sql: `UPDATE leads SET call_attempt_count = call_attempt_count + 1, last_call_at = ?, updated_at = ? WHERE id = ?`,
        args: [now, now, lead.id],
      },
      {
        sql: `INSERT INTO lead_events (lead_id, at, type, actor, meta)
              VALUES (?, ?, 'call_attempt', 'system', ?)`,
        args: [lead.id, now, JSON.stringify({ mode: "ai", purpose, simulated })],
      },
    ],
    "write",
  );

  if (simulated) {
    await db.execute({
      sql: `UPDATE call_attempts SET status = 'completed', summary = '[dev no-op] Vapi unconfigured — call simulated', ended_at = ?, duration_s = 0, cost_cents = 0 WHERE id = ?`,
      args: [nowIso(), id],
    });
    console.log(`[dev no-op] AI call to ${lead.phone_e164} (${purpose}) — Vapi not configured`);
    await writeAudit({
      actor: "system", action: "call_placed", leadId: lead.id, channel: "voice_ai",
      consentTier: lead.consent_tier, meta: { purpose, simulated: true },
    });
    return { callAttemptId: id, simulated: true, vapiCallId: null };
  }

  const res = await fetch(VAPI_BASE + "/call", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.VAPI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assistantId: process.env.VAPI_ASSISTANT_OUTBOUND_ID,
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
      customer: { number: lead.phone_e164 },
      metadata: { leadId: lead.id, purpose, jobId, callAttemptId: id },
    }),
  });

  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    await db.execute({
      sql: "UPDATE call_attempts SET status = 'failed', summary = ? WHERE id = ?",
      args: ["Vapi dial failed: " + text, id],
    });
    throw new Error(`Vapi dial failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id?: string };
  const vapiCallId = data.id ?? null;
  await db.execute({
    sql: "UPDATE call_attempts SET vapi_call_id = ?, status = 'ringing' WHERE id = ?",
    args: [vapiCallId, id],
  });
  await writeAudit({
    actor: "system", action: "call_placed", leadId: lead.id, channel: "voice_ai",
    consentTier: lead.consent_tier, meta: { purpose, vapiCallId },
  });
  return { callAttemptId: id, simulated: false, vapiCallId };
}

/** Best-effort artifact deletion (retention sweep + privacy deletion cascade). */
export async function deleteVapiCallArtifacts(vapiCallId: string): Promise<boolean> {
  if (!process.env.VAPI_API_KEY) return false;
  try {
    const res = await fetch(`${VAPI_BASE}/call/${encodeURIComponent(vapiCallId)}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + process.env.VAPI_API_KEY },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Timing-safe webhook secret check for /api/voice and /api/vapi/tools. */
export function verifyVapiSecret(header: string | null): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Look up a call_attempts row by Vapi call id. */
export async function getCallByVapiId(vapiCallId: string) {
  return qOne({ sql: "SELECT * FROM call_attempts WHERE vapi_call_id = ?", args: [vapiCallId] });
}
