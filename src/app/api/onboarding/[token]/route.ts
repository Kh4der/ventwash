import { getFormByToken, submitOnboarding } from "@/lib/onboarding";
import { getLead } from "@/lib/leads";

/**
 * GET/POST /api/onboarding/[token] — public onboarding intake, gated by the
 * hash-stored 128-bit token. GET returns the form status + business name for
 * prefill; POST sanitizes and submits the intake data (submitOnboarding owns
 * the whitelist, transition, confirmation emails, and inspection draft).
 */

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

// Naive in-memory rate limit (same pattern as /api/quote). Fine for a
// single-instance deployment; resets on redeploy/restart.
const rateMap = new Map<string, number[]>();

const RATE_MAP_MAX_KEYS = 10_000;

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const form = await getFormByToken(token);
  if (!form) {
    return Response.json({ ok: false, error: "Invalid or unknown link." }, { status: 404 });
  }
  const lead = await getLead(form.lead_id);
  const businessName = lead ? String(lead.business_name ?? "") : "";
  return Response.json({ ok: true, status: form.status, businessName });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  // Rate limit by client IP.
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() || "local" : "local";
  if (isRateLimited(ip)) {
    return Response.json(
      { ok: false, error: "Too many requests — please try again in a minute." },
      { status: 429 },
    );
  }

  const { token } = await params;
  const form = await getFormByToken(token);
  if (!form) {
    return Response.json({ ok: false, error: "Invalid or unknown link." }, { status: 404 });
  }
  if (form.status === "expired") {
    return Response.json(
      { ok: false, error: "This onboarding link has expired — ask us for a new one." },
      { status: 410 },
    );
  }

  // Parse body defensively; the payload is { data: { ...fields } }.
  let data: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    const inner = (parsed as Record<string, unknown>).data;
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
      throw new Error("data missing");
    }
    data = inner as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const result = await submitOnboarding(token, data);
  if (!result.ok) {
    const gone = /expired/i.test(result.error);
    return Response.json(result, { status: gone ? 410 : 400 });
  }
  return Response.json({ ok: true });
}
