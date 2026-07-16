import type { Job } from "@/lib/jobs";
import type { HandlerResult } from "@/lib/job-handlers";
import { runDailyDigest } from "@/lib/job-handlers/send-email";

/**
 * daily_digest job handler — the founder heartbeat email. Thin delegate to
 * the shared digest renderer/sender in send-email.ts (the same code serves
 * send_email jobs whose payload.template is 'daily_digest').
 */

export async function run(job: Job): Promise<HandlerResult> {
  return runDailyDigest(job);
}
