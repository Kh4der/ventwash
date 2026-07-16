import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb, q, qOne } from "@/lib/db";
import { toE164US } from "@/lib/phone";
import { addInternalDnc, dncFreshness } from "@/lib/compliance/dnc";
import { revokeConsent } from "@/lib/compliance/consent";

/**
 * /api/admin/dnc — internal Do-Not-Call manager. GET lists the internal list
 * plus national-registry count and sync freshness; POST adds a number (E.164
 * normalized) and runs the full revocation pipeline for any matching lead.
 *
 * There is deliberately NO DELETE handler (spec D12): internal DNC entries
 * are honored indefinitely; removals require direct DB access with a logged
 * reason. Do not add one.
 */

export async function GET() {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  try {
    const [internal, nationalRow, freshness] = await Promise.all([
      q("SELECT phone_e164, reason, added_by, added_at FROM dnc_internal ORDER BY added_at DESC LIMIT 200"),
      qOne("SELECT COUNT(*) AS n FROM dnc_national"),
      dncFreshness(),
    ]);

    return Response.json({
      configured: true,
      internal,
      nationalCount: nationalRow ? Number(nationalRow.n) : 0,
      freshness,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "DNC query failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

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

  const e164 = toE164US(body.phone);
  if (!e164) {
    return Response.json({ error: "Invalid US phone number" }, { status: 400 });
  }

  try {
    await addInternalDnc(e164, "admin", "admin");
    // Full revocation pipeline: tier reset, do_not_contact, job cancellation
    // for any lead matching this number.
    await revokeConsent({
      phoneE164: e164,
      channel: "all",
      source: "admin",
      evidence: "admin DNC add",
      actor: "admin",
    });
    return Response.json({ ok: true, phone: e164 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "DNC add failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
