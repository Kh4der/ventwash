import type { Job } from "@/lib/jobs";
import type { HandlerResult } from "@/lib/job-handlers";
import { qOne } from "@/lib/db";
import { canPlaceAiCall, type CallPurpose, type LeadForCall } from "@/lib/compliance/tcpa";
import { placeOutboundAiCall } from "@/lib/voice/vapi";
import { getAppointment } from "@/lib/appointments";

/**
 * place_ai_call job handler — the ONLY dial path for AI voice.
 *
 * Runs the full compliance gauntlet (canPlaceAiCall) at SEND TIME, not
 * enqueue time: consent may have been revoked, quiet hours may have started,
 * or the kill switch may have been flipped since the job was queued. A
 * refusal returns { blocked } — the job goes to status 'blocked' and is
 * NEVER retried automatically; blocked is blocked.
 *
 * Payload contract: { purpose: CallPurpose, appointmentId? } + job.lead_id.
 */

const PURPOSES: readonly CallPurpose[] = [
  "quote_followup",
  "appointment_confirmation",
  "marketing",
  "cold_intro",
];

function rowToLeadForCall(row: Record<string, unknown>): LeadForCall {
  return {
    id: String(row.id),
    phone_e164: row.phone_e164 ? String(row.phone_e164) : null,
    consent_tier: String(row.consent_tier ?? "none"),
    approval: String(row.approval ?? "not_required"),
    phone_line_type: row.phone_line_type ? String(row.phone_line_type) : null,
    line_type_checked_at: row.line_type_checked_at ? String(row.line_type_checked_at) : null,
    timezone: row.timezone ? String(row.timezone) : null,
    region: row.region ? String(row.region) : null,
    status: String(row.status ?? ""),
    voicemail_count: Number(row.voicemail_count ?? 0),
  };
}

export async function run(job: Job): Promise<HandlerResult> {
  const leadId =
    job.lead_id ?? (typeof job.payload.leadId === "string" ? job.payload.leadId : null);
  if (!leadId) return; // nothing to dial — done, not retried

  // Full lead row: the gate needs every LeadForCall field.
  const row = await qOne({
    sql: "SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL",
    args: [leadId],
  });
  if (!row) return; // missing or privacy-deleted lead — silently done

  const rawPurpose = job.payload.purpose;
  const purpose: CallPurpose = PURPOSES.includes(rawPurpose as CallPurpose)
    ? (rawPurpose as CallPurpose)
    : "quote_followup";

  const appointmentId =
    typeof job.payload.appointmentId === "string" ? job.payload.appointmentId : undefined;

  const lead = rowToLeadForCall(row);

  // SEND-TIME RE-VALIDATION. The gate writes its own audit rows on refusal.
  // A blocked decision is terminal for this job — never caught into a retry.
  const decision = await canPlaceAiCall(lead, purpose, { appointmentId });
  if (!decision.allowed) {
    return { blocked: decision.reason ?? "blocked" };
  }

  // Confirmation calls only fire while the appointment still needs confirming.
  if (purpose === "appointment_confirmation" && appointmentId) {
    const appt = await getAppointment(appointmentId);
    if (!appt || (appt.status !== "tentative" && appt.status !== "rescheduled")) {
      return; // already confirmed / cancelled / done — stale job, quietly complete
    }
  }

  const result = await placeOutboundAiCall(lead, purpose, decision.basis ?? null, job.id);
  return { simulated: result?.simulated };
}
