import { timingSafeEqual } from "node:crypto";
import { getDb, q } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { drainDueJobs } from "@/lib/worker";

/**
 * GET /api/cron/tick — THE cron worker (spec D15, §5). One drain loop, one
 * auth check, one time budget. All timing lives in jobs.run_at + idempotency
 * keys, so over-firing, double-firing, and missed ticks are all safe.
 *
 *  - no ?task    → claim ≤25 due jobs atomically (reaping stale locks first)
 *                  and execute them sequentially under a ~50s wall budget;
 *                  anything claimed but not reached is released back to
 *                  pending for the next tick.
 *  - ?task=digest    → enqueue daily_digest   (key digest:<YYYY-MM-DD>)
 *  - ?task=discovery → enqueue discover_osm   (key discover:<ISO week>) +
 *                      crawl_site for ≤20 uncrawled leads (key crawl:<leadId>)
 *  - ?task=dnc_sync  → enqueue dnc_sync       (key dnc:<YYYY-MM-DD>)
 *  - ?task=retention → enqueue retention_sweep (key retention:<YYYY-MM-DD>)
 *
 * Every request (any task) also enqueues a heartbeat job
 * (key heartbeat:<YYYY-MM-DD-HH>) — the cheap liveness marker behind
 * settings.last_heartbeat_at.
 *
 * Auth: Authorization: Bearer CRON_SECRET (timing-safe). When CRON_SECRET is
 * unset, only non-production requests are allowed (503 in production).
 */

const WORKER_BUDGET_MS = 50_000;

function isAuthorized(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== "production") return { ok: true };
    return {
      ok: false,
      status: 503,
      error:
        "CRON_SECRET is not configured. The cron worker refuses to run unauthenticated in production — set CRON_SECRET and send it as 'Authorization: Bearer <secret>'.",
    };
  }
  const header = request.headers.get("authorization") ?? "";
  const a = Buffer.from(header, "utf8");
  const b = Buffer.from("Bearer " + secret, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

/** UTC day key, e.g. 2026-07-15. */
function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** UTC hour key, e.g. 2026-07-15-09. */
function hourKey(d = new Date()): string {
  return d.toISOString().slice(0, 13).replace("T", "-");
}

/** ISO-8601 year + week number, e.g. 2026-W29. */
function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7; // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // nearest Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Registrable-ish host of a website value (mirrors leads.ts hostOf). */
function hostOf(website: string): string | null {
  try {
    return new URL(website.includes("://") ? website : "https://" + website).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The worker: claim due jobs and execute under the wall-clock budget. */
async function drainQueue(): Promise<Response> {
  const stats = await drainDueJobs({ limit: 25, budgetMs: WORKER_BUDGET_MS });
  return Response.json({ ok: true, ...stats });
}

/** ?task=discovery — weekly Overpass sweep + crawl fan-out for stale leads. */
async function enqueueDiscovery(): Promise<Response> {
  await enqueue({ type: "discover_osm", idempotencyKey: `discover:${isoWeekKey()}` });

  // crawl_site for leads with a website, no contact_points yet, and a domain
  // that hasn't been permanently denied. Key crawl:<leadId> dedupes naturally.
  const deniedRows = await q("SELECT domain FROM crawl_domains WHERE denied = 1");
  const denied = new Set(deniedRows.map((r) => String(r.domain).toLowerCase()));

  const candidates = await q(
    `SELECT l.id, l.website FROM leads l
     WHERE l.deleted_at IS NULL
       AND l.website IS NOT NULL AND l.website != ''
       AND NOT EXISTS (SELECT 1 FROM contact_points cp WHERE cp.lead_id = l.id)
     ORDER BY l.created_at ASC
     LIMIT 100`,
  );

  let crawlJobs = 0;
  for (const row of candidates) {
    if (crawlJobs >= 20) break;
    const host = hostOf(String(row.website ?? ""));
    if (!host || denied.has(host)) continue;
    const leadId = String(row.id);
    await enqueue({
      type: "crawl_site",
      payload: { leadId },
      leadId,
      idempotencyKey: `crawl:${leadId}`,
    });
    crawlJobs++;
  }

  return Response.json({ ok: true, crawlJobs });
}

export async function GET(request: Request) {
  const auth = isAuthorized(request);
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  let task: string | null = null;
  try {
    task = new URL(request.url).searchParams.get("task");
  } catch {
    task = null;
  }

  // Cheap liveness marker on EVERY tick, whatever the task.
  await enqueue({ type: "heartbeat", idempotencyKey: `heartbeat:${hourKey()}` });

  switch (task) {
    case null:
    case "":
      return drainQueue();
    case "digest":
      await enqueue({ type: "daily_digest", idempotencyKey: `digest:${dayKey()}` });
      return Response.json({ ok: true });
    case "discovery":
      return enqueueDiscovery();
    case "dnc_sync":
      await enqueue({ type: "dnc_sync", idempotencyKey: `dnc:${dayKey()}` });
      return Response.json({ ok: true });
    case "retention":
      await enqueue({ type: "retention_sweep", idempotencyKey: `retention:${dayKey()}` });
      return Response.json({ ok: true });
    default:
      return Response.json({ ok: false, error: `Unknown task: ${task}` }, { status: 400 });
  }
}
