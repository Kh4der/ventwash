import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb, qOne, q, nowIso } from "@/lib/db";
import { transition } from "@/lib/lead-machine";
import { writeAudit } from "@/lib/compliance/audit";
import { captureServerEvent } from "@/lib/posthog-server";

/**
 * POST /api/admin/leads/approve — the human-in-the-loop cold-outreach gate.
 * Approving is a logged legal decision: hard-capped at 25 ids per request,
 * only leads sitting at approval='pending' AND status='review_queue' are
 * eligible, and every decision writes approved_by/at, an audit row, and a
 * PostHog event. approve → approved_outreach; reject → lost.
 */

const MAX_IDS = 25;

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action === "approve" || body.action === "reject" ? body.action : null;
  if (!action) {
    return Response.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64)
    : null;
  if (!ids || ids.length === 0) {
    return Response.json({ error: "ids must be a non-empty array of lead ids" }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return Response.json(
      { error: `Bulk approval is hard-capped at ${MAX_IDS} leads per action` },
      { status: 400 },
    );
  }

  const results: { id: string; ok: boolean; error?: string }[] = [];

  for (const id of ids) {
    try {
      const lead = await qOne({
        sql: "SELECT id, approval, status FROM leads WHERE id = ? AND deleted_at IS NULL",
        args: [id],
      });
      if (!lead) {
        results.push({ id, ok: false, error: "not_found" });
        continue;
      }
      if (String(lead.approval) !== "pending" || String(lead.status) !== "review_queue") {
        results.push({ id, ok: false, error: "not_pending_review" });
        continue;
      }

      const now = nowIso();
      await q({
        sql: `UPDATE leads SET approval = ?, approved_by = 'admin', approved_at = ?, updated_at = ?
              WHERE id = ?`,
        args: [action === "approve" ? "approved" : "rejected", now, now, id],
      });

      if (action === "approve") {
        await transition(id, "approved_outreach", "admin", { via: "review_queue_approval" });
      } else {
        await transition(id, "lost", "admin", { reason: "rejected_in_review" });
      }

      await writeAudit({
        actor: "admin",
        action: action === "approve" ? "lead_approved" : "lead_rejected",
        leadId: id,
      });
      await captureServerEvent("lead_approved", { lead_id: id, action });

      results.push({ id, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "approval failed";
      results.push({ id, ok: false, error: message });
    }
  }

  return Response.json({ ok: true, action, results });
}
