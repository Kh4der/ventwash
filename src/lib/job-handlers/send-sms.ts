import type { Job } from "@/lib/jobs";
import type { HandlerResult } from "@/lib/job-handlers";
import { getLead } from "@/lib/leads";
import { getAppointment } from "@/lib/appointments";
import { sendSms } from "@/lib/sms";
import { formatWhen, kindLabel } from "@/lib/email/templates";
import { mapSendResult, appointmentManageUrl } from "@/lib/job-handlers/send-email";

/**
 * send_sms job handler — the 24-hour appointment reminder. Renders a short
 * transactional body and hands it to the sendSms choke point (the ONLY code
 * that talks to Twilio Messages). Re-validates appointment state at send
 * time: a cancelled/completed appointment makes the reminder stale and the
 * job completes as a no-op.
 *
 * Payload contract: { template: 'appointment_reminder_24h', appointmentId }.
 */

export async function run(job: Job): Promise<HandlerResult> {
  const template = String(job.payload.template ?? "");
  if (template !== "appointment_reminder_24h") {
    throw new Error(`send_sms: unknown template '${template}'`);
  }

  const appointmentId =
    typeof job.payload.appointmentId === "string" ? job.payload.appointmentId : "";
  const appt = appointmentId ? await getAppointment(appointmentId) : null;
  if (!appt) return; // appointment gone — stale job
  if (appt.status === "cancelled" || appt.status === "completed") return; // stale reminder

  const lead = await getLead(appt.lead_id);
  if (!lead) return; // deleted — nothing to send

  const to = String(lead.phone_e164 ?? "");
  const when = formatWhen(appt.starts_at, appt.timezone, "short");
  const manageUrl = appointmentManageUrl(appt.id);
  const body = `VentWash: reminder — ${kindLabel(appt.kind)} ${when}. Manage: ${manageUrl}`;

  return mapSendResult(
    await sendSms({
      leadId: appt.lead_id,
      jobId: job.id,
      kind: "transactional",
      template,
      to,
      body,
    }),
  );
}
