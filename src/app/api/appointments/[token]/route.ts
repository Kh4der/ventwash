import { verifyLinkToken } from "@/lib/link-tokens";
import {
  getAppointment,
  confirmAppointment,
  cancelAppointment,
  rescheduleAppointment,
  getAvailableSlots,
  type Appointment,
} from "@/lib/appointments";

/**
 * GET/POST /api/appointments/[token] — customer self-service for a single
 * appointment, gated by the HMAC link token (purpose "appointment").
 * GET returns the appointment + available reschedule slots; POST performs
 * confirm / cancel / reschedule as actor "customer". Reschedule targets must
 * be one of the currently available slots — arbitrary timestamps are refused.
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

function cleanString(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

/** Public shape: appointment details only — no lead id, no PII. */
function publicAppointment(appt: Appointment) {
  return {
    kind: appt.kind,
    status: appt.status,
    startsAt: appt.starts_at,
    endsAt: appt.ends_at,
    timezone: appt.timezone,
    location: appt.location,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const appointmentId = verifyLinkToken("appointment", token);
  if (!appointmentId) {
    return Response.json({ ok: false, error: "Invalid or expired link." }, { status: 404 });
  }
  const appt = await getAppointment(appointmentId);
  if (!appt) {
    return Response.json({ ok: false, error: "Invalid or expired link." }, { status: 404 });
  }
  const slots = await getAvailableSlots(14);
  return Response.json({ ok: true, appointment: publicAppointment(appt), slots });
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
  const appointmentId = verifyLinkToken("appointment", token);
  if (!appointmentId) {
    return Response.json({ ok: false, error: "Invalid or expired link." }, { status: 404 });
  }
  const appt = await getAppointment(appointmentId);
  if (!appt) {
    return Response.json({ ok: false, error: "Invalid or expired link." }, { status: 404 });
  }

  // Parse body defensively.
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const action = cleanString(body.action, 20);

  // Completed / missed appointments are frozen; cancelled ones only accept an
  // idempotent re-cancel.
  if (appt.status === "completed" || appt.status === "no_show") {
    return Response.json(
      { ok: false, error: "This appointment can no longer be changed." },
      { status: 409 },
    );
  }
  if (appt.status === "cancelled" && action !== "cancel") {
    return Response.json(
      { ok: false, error: "This appointment was cancelled — contact us to rebook." },
      { status: 409 },
    );
  }

  let updated: Appointment | null = null;

  if (action === "confirm") {
    updated = await confirmAppointment(appt.id, "customer");
  } else if (action === "cancel") {
    updated =
      appt.status === "cancelled" ? appt : await cancelAppointment(appt.id, "customer");
  } else if (action === "reschedule") {
    const startsAt = cleanString(body.startsAt, 40);
    const slot = (await getAvailableSlots(14)).find((s) => s.startsAt === startsAt);
    if (!slot) {
      return Response.json(
        { ok: false, error: "That time is no longer available — please pick another slot." },
        { status: 400 },
      );
    }
    updated = await rescheduleAppointment(appt.id, slot.startsAt, slot.endsAt, "customer");
  } else {
    return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }

  if (!updated) {
    return Response.json(
      { ok: false, error: "Something went wrong — please try again." },
      { status: 500 },
    );
  }
  return Response.json({ ok: true, appointment: publicAppointment(updated) });
}
