import { verifyVapiSecret } from "@/lib/voice/vapi";
import { getAvailableSlots, createAppointment, businessTimezone } from "@/lib/appointments";
import { getLead, getLeadByPhone } from "@/lib/leads";
import { recordLeadEvent } from "@/lib/lead-machine";
import { revokeConsent } from "@/lib/compliance/consent";
import { raiseAlert } from "@/lib/compliance/audit";
import { toE164US, formatUS } from "@/lib/phone";

/**
 * POST /api/vapi/tools — mid-call tool calls from the Vapi assistants.
 *
 * Tools (the assistant deliberately has NO price or contract tool):
 *  - check_availability  → next open slots, human-readable + ISO stamps
 *  - book_appointment    → TENTATIVE appointment only; a founder confirms
 *  - mark_dnc            → in-call opt-out → full revocation pipeline
 *  - request_callback    → timeline note + info alert for the founders
 *
 * Request shape: { message: { toolCallList | toolCalls: [{ id, function:
 * { name, arguments } }], call: { customer, metadata } } } — arguments may be
 * an object or a JSON string. Response: { results: [{ toolCallId, result }] }.
 */

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, maxLen = 500): string {
  return typeof v === "string" ? v.trim().slice(0, maxLen) : "";
}

/** 401/503 on auth failure, null when the request may proceed. */
function checkVapiAuth(request: Request): Response | null {
  if (!process.env.VAPI_WEBHOOK_SECRET) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[vapi-tools] VAPI_WEBHOOK_SECRET is not set — refusing in production");
      return Response.json({ error: "Webhook secret not configured" }, { status: 503 });
    }
    return null;
  }
  if (!verifyVapiSecret(request.headers.get("x-vapi-secret"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** "Tue Jul 21, 10:00 AM ET (2026-07-21T14:00:00.000Z)" in the business timezone. */
function formatSlot(iso: string): string {
  const d = new Date(iso);
  const tz = businessTimezone();
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric",
  })
    .format(d)
    .replace(",", "");
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
  const zone =
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortGeneric" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value ?? tz;
  return `${date}, ${time} ${zone} (${iso})`;
}

interface CallContext {
  leadId: string | null;
  phoneE164: string | null;
}

/** Prefer metadata.leadId; fall back to the caller's number. */
async function resolveLead(ctx: CallContext, argLeadId?: string) {
  const byId = argLeadId || ctx.leadId;
  if (byId) {
    const lead = await getLead(byId);
    if (lead) return lead;
  }
  if (ctx.phoneE164) return getLeadByPhone(ctx.phoneE164);
  return null;
}

/* ── tool implementations — always return a spoken-friendly string ───────── */

async function checkAvailability(): Promise<string> {
  const slots = await getAvailableSlots(10);
  if (!slots.length) {
    return "No open slots in the next 10 days. Offer to take a callback request instead.";
  }
  const lines = slots.slice(0, 6).map((s) => formatSlot(s.startsAt));
  return "Available times: " + lines.join("; ");
}

async function bookAppointment(
  args: Record<string, unknown>,
  ctx: CallContext,
): Promise<string> {
  const lead = await resolveLead(ctx, str(args.leadId, 100) || undefined);
  if (!lead) {
    return "I couldn't find a customer record for this caller — capture their name and number for a callback instead.";
  }

  const startsAtRaw = str(args.startsAt, 100);
  const parsed = startsAtRaw ? new Date(startsAtRaw) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return "That start time wasn't understood. Ask check_availability for the current open slots and use one of the ISO timestamps.";
  }
  const iso = parsed.toISOString();

  // Re-fetch availability and require an exact slot match — the agent can
  // only book what is genuinely open right now.
  const slots = await getAvailableSlots(10);
  const slot = slots.find((s) => s.startsAt === iso);
  if (!slot) {
    const alternatives = slots.slice(0, 3).map((s) => formatSlot(s.startsAt)).join("; ");
    return (
      "That time is no longer available." +
      (alternatives ? " Nearest open times: " + alternatives : " No open slots in the next 10 days.")
    );
  }

  const kind = str(args.kind, 40) === "inspection" ? "inspection" : "sales_call";
  const appt = await createAppointment({
    leadId: String(lead.id),
    kind,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    createdBy: "vapi",
    status: "tentative",
  });
  if (!appt) return "Booking is unavailable right now — offer to take a callback request instead.";

  return (
    `Tentatively booked a ${kind === "inspection" ? "site inspection" : "call"} for ` +
    `${formatSlot(slot.startsAt)}. Tell the caller our team will confirm shortly.`
  );
}

async function markDnc(ctx: CallContext): Promise<string> {
  const lead = await resolveLead(ctx);
  const phone = ctx.phoneE164 ?? (lead?.phone_e164 ? String(lead.phone_e164) : null);
  if (!lead && !phone) {
    return "I couldn't identify this caller's number, but no further contact will be made.";
  }
  await revokeConsent({
    leadId: lead ? String(lead.id) : null,
    phoneE164: phone,
    channel: "all",
    source: "voice_request",
    evidence: "caller asked via mark_dnc tool",
  });
  return "Done — they won't be contacted again.";
}

async function requestCallback(
  args: Record<string, unknown>,
  ctx: CallContext,
): Promise<string> {
  const preferredTime = str(args.preferredTime, 200) || str(args.preferred_time, 200);
  const lead = await resolveLead(ctx);
  if (lead) {
    await recordLeadEvent(String(lead.id), "note", "vapi", {
      callback: preferredTime || "unspecified",
    });
  }
  const who = lead
    ? String(lead.business_name || "A caller")
    : `Caller ${ctx.phoneE164 ? formatUS(ctx.phoneE164) : "(unknown number)"}`;
  await raiseAlert(
    "info",
    "callback_requested",
    `${who} requested a callback${preferredTime ? " — preferred time: " + preferredTime : ""}.`,
    { leadId: lead ? String(lead.id) : null, preferredTime: preferredTime || null },
  );
  return "Callback noted — tell the caller the team will reach out" +
    (preferredTime ? ` around ${preferredTime}.` : " within one business day.");
}

/* ── route handler ───────────────────────────────────────────────────────── */

export async function POST(request: Request) {
  const authFail = checkVapiAuth(request);
  if (authFail) return authFail;

  let body: Record<string, unknown>;
  try {
    body = obj(await request.json());
  } catch {
    return Response.json({ results: [] }, { status: 400 });
  }

  const msg = obj(body.message);
  const call = obj(msg.call);
  const metadata = obj(call.metadata);
  const ctx: CallContext = {
    leadId: str(metadata.leadId, 100) || null,
    phoneE164: toE164US(str(obj(call.customer).number, 40)),
  };

  const rawList = Array.isArray(msg.toolCallList)
    ? msg.toolCallList
    : Array.isArray(msg.toolCalls)
      ? msg.toolCalls
      : [];

  const results: { toolCallId: string; result: string }[] = [];
  for (const raw of rawList.slice(0, 10)) {
    const tc = obj(raw);
    const fn = obj(tc.function);
    const toolCallId = str(tc.id, 200) || crypto.randomUUID();
    const name = str(fn.name, 100) || str(tc.name, 100);

    // Arguments may arrive as an object or as a JSON string.
    let args: Record<string, unknown>;
    const rawArgs = fn.arguments ?? tc.arguments;
    if (typeof rawArgs === "string") {
      try {
        args = obj(JSON.parse(rawArgs));
      } catch {
        args = {};
      }
    } else {
      args = obj(rawArgs);
    }

    let result: string;
    try {
      switch (name) {
        case "check_availability":
          result = await checkAvailability();
          break;
        case "book_appointment":
          result = await bookAppointment(args, ctx);
          break;
        case "mark_dnc":
          result = await markDnc(ctx);
          break;
        case "request_callback":
          result = await requestCallback(args, ctx);
          break;
        default:
          result = "unsupported tool";
      }
    } catch (err) {
      console.error(`[vapi-tools] ${name || "(unnamed)"} failed:`, err);
      result = "That didn't work just now — offer to take a callback request instead.";
    }
    results.push({ toolCallId, result });
  }

  return Response.json({ results });
}
