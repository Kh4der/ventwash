import { captureServerEvent } from "@/lib/posthog-server";
import { toE164US } from "@/lib/phone";
import { createLead } from "@/lib/leads";
import { recordConsent } from "@/lib/compliance/consent";
import { enqueue } from "@/lib/jobs";
import { QUOTE_CONSENT_LABEL } from "@/lib/quote-consent";

/**
 * POST /api/quote — receives quote requests from the QuoteModal.
 *
 * Validates the lead, applies a naive in-memory rate limit, logs the lead to
 * server logs, and mirrors it into PostHog as a server-side 'quote_submitted'
 * event (full PII stays server-side; the client event carries only
 * business/hoods).
 *
 * Platform dual-write (spec §6.7, D14, D18) — added AFTER the existing
 * capture and wrapped so a DB failure can never break lead capture:
 * upsert the lead (inbound_form, engaged), record the consent event with the
 * verbatim disclosure text (tier express, or express_written when the
 * optional consentCalls checkbox was ticked), and enqueue the quote-ack
 * email, line-type lookup, and the T+5min speed-to-lead AI callback (the
 * compliance gate re-validates everything at dial time).
 */

/** Disclosure recorded when the form is submitted WITHOUT the checkbox. */
const EXPRESS_DISCLOSURE =
  "Quote form submission: contact info volunteered for a quote callback (prior express consent).";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;

// Naive in-memory rate limit. Fine for a single-instance deployment; resets
// on redeploy/restart.
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

export async function POST(request: Request) {
  // Rate limit by client IP.
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() || "local" : "local";
  if (isRateLimited(ip)) {
    return Response.json(
      { ok: false, error: "Too many requests — please try again in a minute." },
      { status: 429 }
    );
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
    return Response.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const name = cleanString(body.name, 200);
  const business = cleanString(body.business, 200);
  const phone = cleanString(body.phone, 200);
  const email = cleanString(body.email, 200);
  const hoods = cleanString(body.hoods, 200);
  const message = cleanString(body.message, 2000);
  const url = cleanString(body.url, 2000);

  if (!name) {
    return Response.json(
      { ok: false, error: "Name is required." },
      { status: 400 }
    );
  }
  if (!phone && !email) {
    return Response.json(
      { ok: false, error: "A phone number or email is required." },
      { status: 400 }
    );
  }

  const rawDistinctId = cleanString(body.distinctId, 200);
  const distinctId = rawDistinctId || crypto.randomUUID();

  await captureServerEvent(
    "quote_submitted",
    {
      name,
      business,
      phone,
      email,
      hoods,
      message,
      url,
      source: "website_quote_form",
    },
    distinctId
  );

  // Always visible in server logs, even without PostHog configured.
  console.log("[quote lead]", {
    name,
    business,
    phone,
    email,
    hoods,
    message,
    url,
    distinctId,
    ip,
    at: new Date().toISOString(),
  });

  // ---- Automation-platform dual-write (spec §6.7). Everything below is
  // best-effort: the site must keep capturing leads even with no database.
  try {
    const consentCalls = body.consentCalls === true;
    const phoneE164 = toE164US(phone);

    const created = await createLead({
      discoverySource: "inbound_form",
      businessName: business || name,
      contactName: name,
      phone: phoneE164 ?? phone,
      email,
      hoods,
      notes: message,
      posthogDistinctId: distinctId,
      status: "engaged",
    });

    // null ⇒ no durable DB (skip silently); blocked ⇒ privacy-deleted contact
    // (never re-create). A dedupe hit returning an existing id is fine.
    if (created && created.id && !created.blocked) {
      const leadId = created.id;

      await recordConsent({
        leadId,
        tier: consentCalls ? "express_written" : "express",
        channelScope: "all",
        source: "quote_form",
        ip,
        formUrl: url,
        disclosureText: consentCalls ? QUOTE_CONSENT_LABEL : EXPRESS_DISCLOSURE,
        rawPayload: { name, business, phone, email, hoods },
      });

      const day = new Date().toISOString().slice(0, 10);
      await enqueue({
        type: "send_email",
        payload: { template: "quote_ack", leadId },
        leadId,
        idempotencyKey: `quote_ack:${leadId}:${day}`,
      });
      await enqueue({
        type: "lookup_line_type",
        payload: { leadId },
        leadId,
        idempotencyKey: `lookup:${leadId}`,
      });
      // Speed-to-lead AI callback (D18) — canPlaceAiCall re-validates flags,
      // consent, DNC, line type, and quiet hours at dial time.
      await enqueue({
        type: "place_ai_call",
        payload: { purpose: "quote_followup" },
        leadId,
        runAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        idempotencyKey: `call:speed_to_lead:${leadId}`,
      });
    }
  } catch (err) {
    // Never let the automation pipeline break the existing capture path.
    console.error("[quote] platform dual-write failed (lead capture unaffected):", err);
  }

  return Response.json({ ok: true });
}
