import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb, q, qOne } from "@/lib/db";

/**
 * GET /api/admin/jobs — the queue inspector (the Jobs panel's data feed).
 * Filterable by status/type, 50 per page, newest first, with global
 * per-status counts so the tab can badge dead jobs even when filtered.
 */

const PAGE_SIZE = 50;

const JOB_STATUSES = [
  "pending", "running", "done", "failed", "dead", "blocked", "cancelled",
] as const;

const JOB_TYPES = new Set([
  "send_email", "send_sms", "place_ai_call", "lookup_line_type", "discover_osm",
  "crawl_site", "score_lead", "onboarding_nudge", "daily_digest", "dnc_sync",
  "retention_sweep", "heartbeat",
]);

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const type = url.searchParams.get("type");

  if (status && !(JOB_STATUSES as readonly string[]).includes(status)) {
    return Response.json({ error: "Unknown status filter" }, { status: 400 });
  }
  if (type && !JOB_TYPES.has(type)) {
    return Response.json({ error: "Unknown type filter" }, { status: 400 });
  }

  const pageRaw = Number(url.searchParams.get("page") ?? "1");
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  const where: string[] = [];
  const args: (string | number)[] = [];
  if (status) { where.push("status = ?"); args.push(status); }
  if (type) { where.push("type = ?"); args.push(type); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  try {
    const [rows, totalRow, countRows] = await Promise.all([
      q({
        sql: `SELECT id, type, status, run_at, attempts, max_attempts, last_error,
                     block_reason, simulated, lead_id, payload, idempotency_key, created_at
              FROM jobs ${whereSql}
              ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        args: [...args, PAGE_SIZE, (page - 1) * PAGE_SIZE],
      }),
      qOne({ sql: `SELECT COUNT(*) AS n FROM jobs ${whereSql}`, args }),
      q("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status"),
    ]);

    const byStatus = new Map(countRows.map((r) => [String(r.status), Number(r.n)]));
    const counts: Record<string, number> = {};
    for (const s of JOB_STATUSES) counts[s] = byStatus.get(s) ?? 0;

    return Response.json({
      configured: true,
      jobs: rows.map((r) => {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(String(r.payload ?? "{}"));
        } catch {
          /* corrupted payload renders as {} */
        }
        return {
          id: String(r.id),
          type: String(r.type),
          status: String(r.status),
          run_at: String(r.run_at),
          attempts: Number(r.attempts),
          max_attempts: Number(r.max_attempts),
          last_error: r.last_error ? String(r.last_error) : null,
          block_reason: r.block_reason ? String(r.block_reason) : null,
          simulated: Number(r.simulated ?? 0) === 1,
          lead_id: r.lead_id ? String(r.lead_id) : null,
          idempotency_key: r.idempotency_key ? String(r.idempotency_key) : null,
          payload,
          created_at: String(r.created_at),
        };
      }),
      total: totalRow ? Number(totalRow.n) : 0,
      page,
      counts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Jobs query failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
