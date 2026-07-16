import type { Job, JobType } from "@/lib/jobs";

/**
 * Job handler registry. The cron worker (/api/cron/tick) looks up handlers
 * here; each handler file exports `run(job)`.
 *
 * Contract:
 *  - return { simulated: true }  → job done, provider was unconfigured (dev no-op)
 *  - return { blocked: reason }  → a compliance gate refused; job → 'blocked',
 *    never retried automatically
 *  - return void / {}            → job done
 *  - throw                       → retry with backoff, dead-letter at max_attempts
 */

export type HandlerResult = { simulated?: boolean; blocked?: string } | void;
export type JobHandler = (job: Job) => Promise<HandlerResult>;

import { run as sendEmail } from "@/lib/job-handlers/send-email";
import { run as sendSms } from "@/lib/job-handlers/send-sms";
import { run as placeAiCall } from "@/lib/job-handlers/place-ai-call";
import { run as lookupLineType } from "@/lib/job-handlers/lookup-line-type";
import { run as discoverOsm } from "@/lib/job-handlers/discover-osm";
import { run as crawlSite } from "@/lib/job-handlers/crawl-site";
import { run as scoreLead } from "@/lib/job-handlers/score-lead";
import { run as onboardingNudge } from "@/lib/job-handlers/onboarding-nudge";
import { run as dailyDigest } from "@/lib/job-handlers/daily-digest";
import { run as dncSync } from "@/lib/job-handlers/dnc-sync";
import { run as retentionSweep } from "@/lib/job-handlers/retention-sweep";
import { run as heartbeat } from "@/lib/job-handlers/heartbeat";

export const HANDLERS: Record<JobType, JobHandler> = {
  send_email: sendEmail,
  send_sms: sendSms,
  place_ai_call: placeAiCall,
  lookup_line_type: lookupLineType,
  discover_osm: discoverOsm,
  crawl_site: crawlSite,
  score_lead: scoreLead,
  onboarding_nudge: onboardingNudge,
  daily_digest: dailyDigest,
  dnc_sync: dncSync,
  retention_sweep: retentionSweep,
  heartbeat: heartbeat,
};
