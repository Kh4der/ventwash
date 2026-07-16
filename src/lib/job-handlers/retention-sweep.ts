import type { Job } from "@/lib/jobs";
import type { HandlerResult } from "@/lib/job-handlers";
import { getDb, nowIso } from "@/lib/db";
import { writeAudit } from "@/lib/compliance/audit";
import { deleteVapiCallArtifacts } from "@/lib/voice/vapi";

/**
 * retention_sweep job handler — weekly data-minimization pass (spec D21, §5).
 * Enqueued by GET /api/cron/tick?task=retention (key `retention:<YYYY-MM-DD>`).
 *
 * What it purges:
 *  - call_attempts older than RECORDING_RETENTION_DAYS (default 90): deletes
 *    provider-side artifacts at Vapi (best-effort), then nulls the local
 *    transcript and recording_url. The summary is KEPT (business memory).
 *  - jobs: done/cancelled older than 30 days, failed older than 90 days.
 *  - messages older than 180 days: body replaced with '[expired]' EXCEPT
 *    kind='cold' (cold bodies are CAN-SPAM compliance evidence); status and
 *    addressing are kept for delivery history.
 *
 * What it NEVER touches (append-only legal record, spec §2):
 *  consent_events, revocations, dnc_internal, dnc_national, audit_log,
 *  lead_events, crawl_log, tombstones.
 */

const DEFAULT_RETENTION_DAYS = 90;
const JOB_DONE_RETENTION_DAYS = 30;
const JOB_FAILED_RETENTION_DAYS = 90;
const MESSAGE_BODY_RETENTION_DAYS = 180;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function run(job: Job): Promise<HandlerResult> {
  void job;
  const db = await getDb();
  if (!db) return { simulated: true };

  const parsed = Number(process.env.RECORDING_RETENTION_DAYS);
  const retentionDays =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
  const cutoff = daysAgoIso(retentionDays);

  // 1. Provider-side recording/transcript deletion (best-effort, per call).
  const stale = await db.execute({
    sql: `SELECT id, vapi_call_id FROM call_attempts
          WHERE created_at < ? AND (transcript IS NOT NULL OR recording_url IS NOT NULL)`,
    args: [cutoff],
  });
  let providerDeleted = 0;
  for (const row of stale.rows as unknown as Record<string, unknown>[]) {
    const vapiCallId = row.vapi_call_id ? String(row.vapi_call_id) : null;
    if (vapiCallId && (await deleteVapiCallArtifacts(vapiCallId))) providerDeleted++;
  }

  // 2. Local purge: null transcript + recording_url, keep summary.
  const purged = await db.execute({
    sql: `UPDATE call_attempts SET transcript = NULL, recording_url = NULL
          WHERE created_at < ? AND (transcript IS NOT NULL OR recording_url IS NOT NULL)`,
    args: [cutoff],
  });

  // 3. Job pruning (jobs are operational, not legal record).
  const jobsDone = await db.execute({
    sql: `DELETE FROM jobs WHERE status IN ('done', 'cancelled') AND created_at < ?`,
    args: [daysAgoIso(JOB_DONE_RETENTION_DAYS)],
  });
  const jobsFailed = await db.execute({
    sql: `DELETE FROM jobs WHERE status = 'failed' AND created_at < ?`,
    args: [daysAgoIso(JOB_FAILED_RETENTION_DAYS)],
  });

  // 4. Expire old message bodies — cold bodies are kept (CAN-SPAM evidence),
  //    and status/addressing always survive for delivery history.
  const expired = await db.execute({
    sql: `UPDATE messages SET body = '[expired]'
          WHERE created_at < ? AND kind != 'cold' AND body != '[expired]'`,
    args: [daysAgoIso(MESSAGE_BODY_RETENTION_DAYS)],
  });

  await writeAudit({
    actor: "cron",
    action: "retention_sweep",
    meta: {
      retentionDays,
      cutoff,
      providerArtifactsDeleted: providerDeleted,
      callAttemptsPurged: purged.rowsAffected,
      jobsPrunedDoneCancelled: jobsDone.rowsAffected,
      jobsPrunedFailed: jobsFailed.rowsAffected,
      messageBodiesExpired: expired.rowsAffected,
      sweptAt: nowIso(),
    },
  });
}
