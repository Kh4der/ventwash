import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb, nowIso } from "@/lib/db";
import { writeAudit } from "@/lib/compliance/audit";

/**
 * POST /api/admin/jobs/[id]/retry — reset a failed/dead/blocked job to
 * pending with a fresh attempt budget. This is the ONLY way a blocked job
 * runs again: an explicit, audited admin decision — never automatic.
 */

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
    const res = await db.execute({
      sql: `UPDATE jobs
            SET status = 'pending', attempts = 0, run_at = ?, last_error = NULL,
                block_reason = NULL, locked_at = NULL, updated_at = ?
            WHERE id = ? AND status IN ('failed', 'dead', 'blocked')`,
      args: [nowIso(), nowIso(), id],
    });

    if (res.rowsAffected === 0) {
      return Response.json(
        { error: "Job not found or not in a retryable state (failed/dead/blocked)" },
        { status: 409 },
      );
    }

    await writeAudit({ actor: "admin", action: "job_retried", meta: { jobId: id } });
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job retry failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
