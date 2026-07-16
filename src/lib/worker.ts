import { q, nowIso } from "@/lib/db";
import { claimDueJobs, completeJob, failJob, blockJob } from "@/lib/jobs";
import { HANDLERS, type JobHandler } from "@/lib/job-handlers";

/**
 * The job drain loop — shared by the cron worker (/api/cron/tick) and by
 * latency-sensitive callers that want their just-enqueued work to run NOW
 * rather than on the next tick (e.g. /api/voice fires this from after() when a
 * call ends, so the founder's call summary and the customer's confirmation go
 * out within seconds of hangup instead of up to a cron interval later).
 *
 * Safe to run concurrently with the cron: claimDueJobs() claims atomically, so
 * whichever drain gets there first wins and the other simply finds nothing.
 * The cron remains the safety net for anything an inline drain misses.
 */

export interface DrainStats {
  claimed: number;
  executed: number;
  blocked: number;
  failed: number;
  released: number;
  tookMs: number;
}

export async function drainDueJobs(
  opts: { limit?: number; budgetMs?: number } = {},
): Promise<DrainStats> {
  const limit = opts.limit ?? 25;
  const budgetMs = opts.budgetMs ?? 50_000;
  const started = Date.now();
  const jobs = await claimDueJobs(limit);
  let executed = 0;
  let blocked = 0;
  let failed = 0;

  let i = 0;
  for (; i < jobs.length; i++) {
    if (Date.now() - started > budgetMs) break;
    const job = jobs[i];
    const handler = HANDLERS[job.type] as JobHandler | undefined;
    if (!handler) {
      // Unknown type: never let one bad row wedge the queue.
      await failJob(job, new Error(`unknown job type: ${job.type}`));
      failed++;
      continue;
    }
    try {
      const result = await handler(job);
      if (result && result.blocked) {
        await blockJob(job.id, result.blocked);
        blocked++;
      } else {
        await completeJob(job.id, result?.simulated ?? false);
        executed++;
      }
    } catch (err) {
      await failJob(job, err);
      failed++;
    }
  }

  // Budget exhausted: release unexecuted claimed jobs back to pending so they
  // run next tick. The claim incremented attempts; give that attempt back —
  // the job never actually ran.
  let released = 0;
  for (; i < jobs.length; i++) {
    await q({
      sql: `UPDATE jobs SET status = 'pending', locked_at = NULL,
                            attempts = MAX(attempts - 1, 0), updated_at = ?
            WHERE id = ? AND status = 'running'`,
      args: [nowIso(), jobs[i].id],
    });
    released++;
  }

  return {
    claimed: jobs.length,
    executed,
    blocked,
    failed,
    released,
    tookMs: Date.now() - started,
  };
}
