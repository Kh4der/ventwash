/**
 * POST /api/admin/discovery/run — founder-triggered discovery actions.
 * {task:'osm'} enqueues an Overpass sweep; {task:'recrawl', leadId} enqueues
 * a crawl_site for one lead. Both are hour-bucketed idempotency keys, so
 * mashing the button inside the same hour is a no-op. Admin cookie auth;
 * side effects only ever happen through the jobs outbox.
 */

import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { getLead } from "@/lib/leads";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // malformed/empty body handled below
  }
  const task = typeof body.task === "string" ? body.task.slice(0, 32) : "";
  // yyyy-mm-dd-hh bucket: manual triggers dedupe within the current hour.
  const hourBucket = new Date().toISOString().slice(0, 13).replace("T", "-");

  if (task === "osm") {
    const jobId = await enqueue({
      type: "discover_osm",
      idempotencyKey: `discover:manual:${hourBucket}`,
    });
    return Response.json({ ok: true, jobId });
  }

  if (task === "recrawl") {
    const leadId = typeof body.leadId === "string" ? body.leadId.slice(0, 64) : "";
    if (!leadId) {
      return Response.json({ error: "leadId required for recrawl" }, { status: 400 });
    }
    const lead = await getLead(leadId);
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
    const jobId = await enqueue({
      type: "crawl_site",
      leadId,
      payload: { leadId },
      idempotencyKey: `crawl:${leadId}:manual:${hourBucket}`,
    });
    return Response.json({ ok: true, jobId });
  }

  return Response.json({ error: "Unknown task (expected 'osm' or 'recrawl')" }, { status: 400 });
}
