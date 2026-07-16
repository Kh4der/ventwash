import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { getLead } from "@/lib/leads";
import { enqueue } from "@/lib/jobs";
import { canPlaceAiCall, type CallPurpose, type LeadForCall } from "@/lib/compliance/tcpa";

/**
 * POST /api/admin/leads/[id]/call — queue an AI call for a CONSENTED lead.
 * canPlaceAiCall is the choke point: tier 'none' surfaces here as a 403 and
 * there is NO override. 'cold_intro' is not an accepted purpose — an AI cold
 * intro is not a thing this system can do. On pass we enqueue place_ai_call
 * (hour-bucketed idempotency key so double-clicks don't double-dial); the
 * handler re-runs the full gauntlet at dial time.
 */

const PURPOSES = new Set<string>(["quote_followup", "appointment_confirmation", "marketing"]);

function toLeadForCall(row: Record<string, unknown>): LeadForCall {
  return {
    id: String(row.id),
    phone_e164: row.phone_e164 ? String(row.phone_e164) : null,
    consent_tier: String(row.consent_tier),
    approval: String(row.approval),
    phone_line_type: row.phone_line_type ? String(row.phone_line_type) : null,
    line_type_checked_at: row.line_type_checked_at ? String(row.line_type_checked_at) : null,
    timezone: row.timezone ? String(row.timezone) : null,
    region: row.region ? String(row.region) : null,
    status: String(row.status),
    voicemail_count: Number(row.voicemail_count ?? 0),
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const purpose = typeof body.purpose === "string" ? body.purpose : "";
  if (!PURPOSES.has(purpose)) {
    return Response.json(
      { error: "purpose must be quote_followup, appointment_confirmation or marketing" },
      { status: 400 },
    );
  }

  try {
    const row = await getLead(id);
    if (!row) return Response.json({ error: "Lead not found" }, { status: 404 });

    const lead = toLeadForCall(row);
    const decision = await canPlaceAiCall(lead, purpose as CallPurpose);
    if (!decision.allowed) {
      return Response.json({ error: decision.reason ?? "blocked" }, { status: 403 });
    }

    const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const jobId = await enqueue({
      type: "place_ai_call",
      payload: { purpose },
      leadId: id,
      idempotencyKey: `call:admin:${id}:${hour}`,
    });

    // jobId === null ⇒ an identical call is already queued this hour (no-op).
    return Response.json({ ok: true, queued: true, jobId, deduped: jobId === null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Call enqueue failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
