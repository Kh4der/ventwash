import type { Job } from "@/lib/jobs";
import type { HandlerResult } from "@/lib/job-handlers";
import { setSetting, nowIso } from "@/lib/db";

/**
 * heartbeat job handler — cheap liveness marker. Every cron tick enqueues one
 * (hourly-deduped via `heartbeat:<YYYY-MM-DD-HH>`); executing it stamps
 * settings.last_heartbeat_at. A stale stamp means the worker loop itself is
 * down — surfaced by the daily digest (the dead-man switch) and the admin
 * Compliance panel.
 */
export async function run(job: Job): Promise<HandlerResult> {
  void job;
  await setSetting("last_heartbeat_at", nowIso());
}
