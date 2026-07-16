import { createHash, timingSafeEqual } from "node:crypto";
import { getDb, q } from "@/lib/db";
import { buildIcsCalendar, type IcsEvent } from "@/lib/ics";

/**
 * GET /api/admin/calendar.ics?key= — the read-only founder subscribe feed
 * (zero OAuth; paste the URL into Google/Apple/Outlook). Auth is the static
 * ADMIN_ICS_FEED_KEY compared timing-safe — NOT the admin cookie, because
 * calendar clients can't send cookies. Unset key env ⇒ 404 always, so the
 * feed simply does not exist until a key is configured.
 */

const KIND_LABEL: Record<string, string> = {
  sales_call: "Sales call",
  inspection: "Inspection",
  cleaning: "Cleaning",
};

function keyMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  // Hash both sides so buffers always have equal length (timing-safe).
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const expected = process.env.ADMIN_ICS_FEED_KEY;
  if (!expected) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  if (!keyMatches(url.searchParams.get("key"), expected)) {
    return new Response("Not found", { status: 404 });
  }

  const icsHeaders = {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": "inline; filename=ventwash.ics",
  };

  const db = await getDb();
  if (!db) {
    // No durable DB: serve a valid empty calendar so subscribed clients
    // don't error, rather than a JSON body they can't parse.
    return new Response(buildIcsCalendar([]), { headers: icsHeaders });
  }

  try {
    const now = Date.now();
    const from = new Date(now - 7 * 24 * 3600_000).toISOString();
    const to = new Date(now + 90 * 24 * 3600_000).toISOString();

    const rows = await q({
      sql: `SELECT a.id, a.kind, a.status, a.starts_at, a.ends_at, a.ics_sequence,
                   a.location, a.notes, l.business_name
            FROM appointments a
            LEFT JOIN leads l ON l.id = a.lead_id
            WHERE a.starts_at >= ? AND a.starts_at <= ?
            ORDER BY a.starts_at ASC`,
      args: [from, to],
    });

    const events: IcsEvent[] = rows.map((r) => {
      const kind = String(r.kind);
      const business = String(r.business_name ?? "");
      const status = String(r.status);
      const notes = String(r.notes ?? "");
      return {
        uid: String(r.id),
        sequence: Number(r.ics_sequence ?? 0),
        startsAt: String(r.starts_at),
        endsAt: String(r.ends_at),
        summary: `VentWash: ${KIND_LABEL[kind] ?? kind} — ${business}`,
        location: String(r.location ?? "") || undefined,
        description: `Status: ${status}` + (notes ? `\n${notes}` : ""),
      };
    });

    return new Response(buildIcsCalendar(events), { headers: icsHeaders });
  } catch {
    return new Response("Feed error", { status: 500 });
  }
}
