import type { Job } from "@/lib/jobs";
import type { HandlerResult } from "@/lib/job-handlers";
import { qOne } from "@/lib/db";
import { getLead } from "@/lib/leads";
import { sendEmail } from "@/lib/email/send";
import { onboarding_invite } from "@/lib/email/templates";
import { mapSendResult } from "@/lib/job-handlers/send-email";

/**
 * onboarding_nudge job handler — the T+3d / T+7d re-invites queued by
 * issueOnboardingForm. No-ops once the form is submitted; otherwise re-sends
 * the onboarding invite with nudge copy through the sendEmail choke point.
 *
 * Payload contract: { leadId, onboardingUrl, nudge: 1|2 } + job.lead_id.
 */

export async function run(job: Job): Promise<HandlerResult> {
  const leadId =
    job.lead_id ?? (typeof job.payload.leadId === "string" ? job.payload.leadId : null);
  if (!leadId) throw new Error("onboarding_nudge requires a lead id");

  const form = await qOne({
    sql: "SELECT status FROM onboarding_forms WHERE lead_id = ?",
    args: [leadId],
  });
  if (form && String(form.status) === "submitted") return; // done — nudge is moot

  const lead = await getLead(leadId);
  if (!lead) return; // deleted — nothing to send

  const onboardingUrl =
    typeof job.payload.onboardingUrl === "string" ? job.payload.onboardingUrl : "";
  if (!onboardingUrl) throw new Error("onboarding_nudge requires payload.onboardingUrl");
  const nudge = Number(job.payload.nudge ?? 1) || 1;

  const t = onboarding_invite(lead, onboardingUrl, nudge);
  return mapSendResult(
    await sendEmail({
      leadId,
      jobId: job.id,
      kind: "transactional",
      template: "onboarding_invite",
      to: String(lead.email ?? ""),
      ...t,
    }),
  );
}
