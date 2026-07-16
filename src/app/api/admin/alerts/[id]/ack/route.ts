import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb, nowIso } from "@/lib/db";

/**
 * POST /api/admin/alerts/[id]/ack — acknowledge an admin alert (clears it
 * from the red banner / alert center). Acknowledging is idempotent; the
 * original alert row and timestamp are preserved.
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
  const alertId = Number(id);
  if (!Number.isInteger(alertId) || alertId < 1) {
    return Response.json({ error: "Invalid alert id" }, { status: 400 });
  }

  try {
    await db.execute({
      sql: "UPDATE admin_alerts SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL",
      args: [nowIso(), alertId],
    });
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Alert ack failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
