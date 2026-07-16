import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb, q, getSetting } from "@/lib/db";
import type { LeadStatus } from "@/lib/lead-machine";

/**
 * GET /api/admin/pipeline — the Pipeline tab's data feed: lifecycle funnel
 * counts (0-filled across all 13 statuses), job-queue depth, the next 7 days
 * of appointments, recent lead activity, consent-tier breakdown, and the
 * dead-man heartbeat timestamp. DB rows are canonical here — never PostHog.
 */

const ALL_STATUSES: LeadStatus[] = [
  "discovered",
  "enriched",
  "review_queue",
  "approved_outreach",
  "contacting",
  "engaged",
  "appointment_scheduled",
  "won_pending_onboarding",
  "onboarded",
  "inspection_scheduled",
  "customer",
  "lost",
  "do_not_contact",
];

const CONSENT_TIERS = ["none", "express", "express_written"];

const QUEUE_STATUSES = ["pending", "running", "blocked", "dead", "failed"] as const;

export async function GET() {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  try {
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 24 * 3600_000);

    const [statusRows, jobRows, apptRows, activityRows, consentRows, lastHeartbeat] =
      await Promise.all([
        q("SELECT status, COUNT(*) AS n FROM leads WHERE deleted_at IS NULL GROUP BY status"),
        q("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status"),
        q({
          sql: `SELECT a.id, a.kind, a.status, a.starts_at, l.business_name
                FROM appointments a
                LEFT JOIN leads l ON l.id = a.lead_id
                WHERE a.starts_at >= ? AND a.starts_at <= ?
                  AND a.status IN ('tentative','confirmed','rescheduled')
                ORDER BY a.starts_at ASC`,
          args: [now.toISOString(), in7d.toISOString()],
        }),
        q(
          `SELECT e.id, e.lead_id, e.at, e.type, e.from_status, e.to_status, e.actor, e.meta,
                  l.business_name
           FROM lead_events e
           LEFT JOIN leads l ON l.id = e.lead_id
           ORDER BY e.id DESC LIMIT 20`,
        ),
        q(
          "SELECT consent_tier AS tier, COUNT(*) AS n FROM leads WHERE deleted_at IS NULL GROUP BY consent_tier",
        ),
        getSetting("last_heartbeat_at"),
      ]);

    const statusCounts = new Map(statusRows.map((r) => [String(r.status), Number(r.n)]));
    const jobCounts = new Map(jobRows.map((r) => [String(r.status), Number(r.n)]));
    const tierCounts = new Map(consentRows.map((r) => [String(r.tier), Number(r.n)]));

    const queueDepth: Record<string, number> = {};
    for (const s of QUEUE_STATUSES) queueDepth[s] = jobCounts.get(s) ?? 0;

    return Response.json({
      configured: true,
      funnel: ALL_STATUSES.map((status) => ({
        status,
        count: statusCounts.get(status) ?? 0,
      })),
      queueDepth,
      upcomingAppointments: apptRows.map((r) => ({
        id: String(r.id),
        leadBusiness: String(r.business_name ?? ""),
        kind: String(r.kind),
        status: String(r.status),
        startsAt: String(r.starts_at),
      })),
      recentActivity: activityRows.map((r) => {
        let meta: Record<string, unknown> = {};
        try {
          meta = JSON.parse(String(r.meta ?? "{}"));
        } catch {
          /* keep {} */
        }
        return {
          id: Number(r.id),
          leadId: String(r.lead_id),
          business: String(r.business_name ?? ""),
          at: String(r.at),
          type: String(r.type),
          fromStatus: r.from_status ? String(r.from_status) : null,
          toStatus: r.to_status ? String(r.to_status) : null,
          actor: String(r.actor),
          meta,
        };
      }),
      consentBreakdown: CONSENT_TIERS.map((tier) => ({
        tier,
        count: tierCounts.get(tier) ?? 0,
      })),
      lastHeartbeat,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pipeline query failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
