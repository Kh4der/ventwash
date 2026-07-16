import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { listChannelFlags, setChannelFlag, type Channel } from "@/lib/flags";

/**
 * POST /api/admin/flags — the kill-switch strip's toggle endpoint. Validates
 * the channel against the 7 known flags, flips it (setChannelFlag writes the
 * audit row), and returns the full flag list for optimistic UI refresh.
 */

const CHANNELS = new Set<string>([
  "voice_outbound_ai",
  "voice_outbound_bridge",
  "sms",
  "email_transactional",
  "email_cold",
  "crawler",
  "discovery",
]);

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

  const channel = typeof body.channel === "string" ? body.channel : "";
  if (!CHANNELS.has(channel)) {
    return Response.json({ error: "Unknown channel" }, { status: 400 });
  }

  try {
    await setChannelFlag(channel as Channel, Boolean(body.enabled), "admin");
    return Response.json({ ok: true, flags: await listChannelFlags() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Flag toggle failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
