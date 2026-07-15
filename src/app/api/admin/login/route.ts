import { cookies } from "next/headers";
import { checkPassword, createSessionToken, COOKIE_NAME } from "@/lib/admin-auth";

// Naive in-memory per-IP rate limit (mirrors /api/quote). Fine for a
// single-instance deployment; resets on redeploy/restart.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;
const RATE_MAP_MAX_KEYS = 10_000;
const rateMap = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  // Bound memory: sweep stale entries once the map grows large.
  if (rateMap.size > RATE_MAP_MAX_KEYS) {
    for (const [key, times] of rateMap) {
      if (times.length === 0 || now - times[times.length - 1] >= RATE_WINDOW_MS) {
        rateMap.delete(key);
      }
    }
    if (rateMap.size > RATE_MAP_MAX_KEYS) rateMap.clear();
  }
  const hits = (rateMap.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    rateMap.set(ip, hits);
    return true;
  }
  hits.push(now);
  rateMap.set(ip, hits);
  return false;
}

export async function POST(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() || "local" : "local";
  if (isRateLimited(ip)) {
    return Response.json(
      { error: "Too many attempts — please try again in a minute." },
      { status: 429 },
    );
  }

  if (!process.env.ADMIN_PASSWORD) {
    return Response.json(
      { error: "ADMIN_PASSWORD is not set in .env.local" },
      { status: 500 },
    );
  }

  let password = "";
  try {
    const body = await request.json();
    if (typeof body?.password === "string") password = body.password;
  } catch {
    // fall through — empty password will fail the check
  }

  if (!checkPassword(password)) {
    // Small fixed delay to blunt brute-force attempts.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
    secure: process.env.NODE_ENV === "production",
  });

  return Response.json({ ok: true });
}
