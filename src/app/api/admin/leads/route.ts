import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb, q, qOne } from "@/lib/db";

/**
 * GET /api/admin/leads — paginated lead list for the Pipeline/Review tabs.
 * Filters: status, source, consent, approval (whitelist-validated) and a free
 * q= search (LIKE over business/contact/email/phone with %_ escaped).
 * Deleted leads are always excluded. 50 per page, updated_at DESC.
 */

const PAGE_SIZE = 50;

const STATUSES = new Set([
  "discovered", "enriched", "review_queue", "approved_outreach", "contacting",
  "engaged", "appointment_scheduled", "won_pending_onboarding", "onboarded",
  "inspection_scheduled", "customer", "lost", "do_not_contact",
]);
const SOURCES = new Set([
  "osm", "csv_import", "own_website", "gov_open_data", "inbound_form",
  "inbound_call", "manual",
]);
const CONSENTS = new Set(["none", "express", "express_written"]);
const APPROVALS = new Set(["not_required", "pending", "approved", "rejected"]);

/** Escape LIKE wildcards so user input matches literally (ESCAPE '\'). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const source = url.searchParams.get("source");
  const consent = url.searchParams.get("consent");
  const approval = url.searchParams.get("approval");
  const search = (url.searchParams.get("q") ?? "").trim().slice(0, 200);

  if (status && !STATUSES.has(status)) {
    return Response.json({ error: "Unknown status filter" }, { status: 400 });
  }
  if (source && !SOURCES.has(source)) {
    return Response.json({ error: "Unknown source filter" }, { status: 400 });
  }
  if (consent && !CONSENTS.has(consent)) {
    return Response.json({ error: "Unknown consent filter" }, { status: 400 });
  }
  if (approval && !APPROVALS.has(approval)) {
    return Response.json({ error: "Unknown approval filter" }, { status: 400 });
  }

  const pageRaw = Number(url.searchParams.get("page") ?? "1");
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  const where: string[] = ["deleted_at IS NULL"];
  const args: (string | number)[] = [];
  if (status) { where.push("status = ?"); args.push(status); }
  if (source) { where.push("discovery_source = ?"); args.push(source); }
  if (consent) { where.push("consent_tier = ?"); args.push(consent); }
  if (approval) { where.push("approval = ?"); args.push(approval); }
  if (search) {
    const like = "%" + escapeLike(search) + "%";
    where.push(
      `(business_name LIKE ? ESCAPE '\\' OR contact_name LIKE ? ESCAPE '\\'
        OR email LIKE ? ESCAPE '\\' OR phone_e164 LIKE ? ESCAPE '\\')`,
    );
    args.push(like, like, like, like);
  }
  const whereSql = where.join(" AND ");

  try {
    const [leads, totalRow] = await Promise.all([
      q({
        sql: `SELECT * FROM leads WHERE ${whereSql}
              ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        args: [...args, PAGE_SIZE, (page - 1) * PAGE_SIZE],
      }),
      qOne({ sql: `SELECT COUNT(*) AS n FROM leads WHERE ${whereSql}`, args }),
    ]);

    return Response.json({
      configured: true,
      leads,
      total: totalRow ? Number(totalRow.n) : 0,
      page,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lead query failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
