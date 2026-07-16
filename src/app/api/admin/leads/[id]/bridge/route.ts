import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { getLead } from "@/lib/leads";
import { canPlaceBridgeCall, type LeadForCall } from "@/lib/compliance/tcpa";
import { placeBridgeCall } from "@/lib/voice/bridge";

/**
 * POST /api/admin/leads/[id]/bridge — founder click-to-dial: Twilio calls the
 * founder's phone, then bridges a HUMAN conversation to the lead. This is the
 * only system-mediated path to a tier-'none' phone. canPlaceBridgeCall gates
 * it (approval + landline/fixed-VoIP + fresh DNC + quiet hours) and the call
 * is placed immediately — real-time human action, not a queued job.
 */

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
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  const { id } = await params;

  try {
    const row = await getLead(id);
    if (!row) return Response.json({ error: "Lead not found" }, { status: 404 });

    const lead = toLeadForCall(row);
    const decision = await canPlaceBridgeCall(lead);
    if (!decision.allowed) {
      return Response.json({ error: decision.reason ?? "blocked" }, { status: 403 });
    }

    const result = await placeBridgeCall(lead, "admin");
    if (!result) return Response.json({ configured: false });

    return Response.json({
      ok: true,
      callAttemptId: result.callAttemptId,
      simulated: result.simulated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bridge call failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
