import { getDb, q, nowIso } from "@/lib/db";

/**
 * The durable jobs outbox — the ONLY place side effects originate.
 * Webhooks, forms, and admin actions enqueue; the cron worker
 * (/api/cron/tick) claims and executes. Design properties:
 *
 *  - Atomic claiming (UPDATE ... WHERE id IN (SELECT ...) RETURNING) so
 *    overlapping cron fires never double-run a job.
 *  - idempotency_key UNIQUE: re-enqueueing the same logical job is a no-op.
 *  - Stale-lock reaper: a serverless function killed mid-job leaves
 *    status='running'; anything running >10 min goes back to pending.
 *  - Backoff retries (attempts² × 5 min), dead-letter at max_attempts.
 *  - status='blocked' is terminal-by-default: a compliance gate refused the
 *    job. Blocked jobs are never retried blindly — only an explicit admin
 *    retry resets them.
 */

export type JobType =
  | "send_email"
  | "send_sms"
  | "place_ai_call"
  | "lookup_line_type"
  | "discover_osm"
  | "crawl_site"
  | "score_lead"
  | "onboarding_nudge"
  | "daily_digest"
  | "dnc_sync"
  | "retention_sweep"
  | "heartbeat";

export interface Job {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  lead_id: string | null;
  status: string;
  run_at: string;
  attempts: number;
  max_attempts: number;
  idempotency_key: string | null;
  simulated: number;
}

const STALE_LOCK_MS = 10 * 60 * 1000;

export interface EnqueueOptions {
  type: JobType;
  payload?: Record<string, unknown>;
  leadId?: string | null;
  /** ISO timestamp; defaults to now (run on next tick). */
  runAt?: string;
  /** Stable key, e.g. 'sms:appt_24h:<apptId>:<seq>'. Re-enqueue is a no-op. */
  idempotencyKey?: string;
  maxAttempts?: number;
}

/** Insert a job. Returns the job id, or null if deduped/DB unavailable. */
export async function enqueue(opts: EnqueueOptions): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const id = crypto.randomUUID();
  const now = nowIso();
  const res = await db.execute({
    sql: `INSERT INTO jobs (id, type, payload, lead_id, status, run_at, max_attempts, idempotency_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
          ON CONFLICT(idempotency_key) DO NOTHING`,
    args: [
      id,
      opts.type,
      JSON.stringify(opts.payload ?? {}),
      opts.leadId ?? null,
      opts.runAt ?? now,
      opts.maxAttempts ?? 5,
      opts.idempotencyKey ?? null,
      now,
      now,
    ],
  });
  return res.rowsAffected > 0 ? id : null;
}

function rowToJob(r: Record<string, unknown>): Job {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(String(r.payload ?? "{}"));
  } catch {
    /* corrupted payload surfaces as {} and the handler fails it */
  }
  return {
    id: String(r.id),
    type: String(r.type) as JobType,
    payload,
    lead_id: r.lead_id ? String(r.lead_id) : null,
    status: String(r.status),
    run_at: String(r.run_at),
    attempts: Number(r.attempts),
    max_attempts: Number(r.max_attempts),
    idempotency_key: r.idempotency_key ? String(r.idempotency_key) : null,
    simulated: Number(r.simulated ?? 0),
  };
}

/** Reap stale locks, then atomically claim up to `limit` due jobs. */
export async function claimDueJobs(limit = 25): Promise<Job[]> {
  const db = await getDb();
  if (!db) return [];
  const now = nowIso();
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS).toISOString();

  // A hard crash (OOM, timeout) can kill the worker before failJob runs,
  // leaving status='running'. Dead-letter those that already exhausted their
  // attempts; reset the rest to pending. Without the first statement such a
  // job would be reaped and re-claimed forever, re-crashing every tick.
  await db.execute({
    sql: `UPDATE jobs SET status = 'dead', locked_at = NULL, updated_at = ?,
            last_error = COALESCE(last_error, 'worker crashed mid-job (stale lock, attempts exhausted)')
          WHERE status = 'running' AND locked_at < ? AND attempts >= max_attempts`,
    args: [now, staleBefore],
  });
  await db.execute({
    sql: `UPDATE jobs SET status = 'pending', locked_at = NULL, updated_at = ?
          WHERE status = 'running' AND locked_at < ?`,
    args: [now, staleBefore],
  });

  const res = await db.execute({
    sql: `UPDATE jobs
          SET status = 'running', locked_at = ?, attempts = attempts + 1, updated_at = ?
          WHERE id IN (SELECT id FROM jobs
                       WHERE status = 'pending' AND run_at <= ? AND attempts < max_attempts
                       ORDER BY run_at LIMIT ?)
          RETURNING *`,
    args: [now, now, now, limit],
  });
  return (res.rows as unknown as Record<string, unknown>[]).map(rowToJob);
}

export async function completeJob(id: string, simulated = false): Promise<void> {
  await q({
    sql: "UPDATE jobs SET status = 'done', simulated = ?, updated_at = ? WHERE id = ?",
    args: [simulated ? 1 : 0, nowIso(), id],
  });
}

/** Retry with backoff, or dead-letter once attempts are exhausted. */
export async function failJob(job: Job, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const now = nowIso();
  if (job.attempts >= job.max_attempts) {
    await q({
      sql: "UPDATE jobs SET status = 'dead', last_error = ?, updated_at = ? WHERE id = ?",
      args: [message.slice(0, 2000), now, job.id],
    });
    return;
  }
  const backoffMs = job.attempts * job.attempts * 5 * 60 * 1000;
  const runAt = new Date(Date.now() + backoffMs).toISOString();
  await q({
    sql: "UPDATE jobs SET status = 'pending', last_error = ?, run_at = ?, locked_at = NULL, updated_at = ? WHERE id = ?",
    args: [message.slice(0, 2000), runAt, now, job.id],
  });
}

/** A compliance gate refused this job. Not retried unless an admin resets it. */
export async function blockJob(id: string, reason: string): Promise<void> {
  await q({
    sql: "UPDATE jobs SET status = 'blocked', block_reason = ?, updated_at = ? WHERE id = ?",
    args: [reason, nowIso(), id],
  });
}

/**
 * Cancel pending/blocked jobs whose idempotency_key starts with the prefix —
 * used when an appointment is rescheduled/cancelled (stale reminders) and
 * when consent is revoked (kill everything queued for the lead).
 */
export async function cancelByKeyPrefix(prefix: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const res = await db.execute({
    sql: `UPDATE jobs SET status = 'cancelled', updated_at = ?
          WHERE idempotency_key LIKE ? AND status IN ('pending', 'blocked')`,
    args: [nowIso(), prefix + "%"],
  });
  return res.rowsAffected;
}

/** Cancel all pending/blocked jobs for a lead (revocation pipeline). */
export async function cancelJobsForLead(leadId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const res = await db.execute({
    sql: `UPDATE jobs SET status = 'cancelled', updated_at = ?
          WHERE lead_id = ? AND status IN ('pending', 'blocked')`,
    args: [nowIso(), leadId],
  });
  return res.rowsAffected;
}
