import { after } from "next/server";
import { getDb, nowIso, q, qOne } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { drainDueJobs } from "@/lib/worker";
import { verifyVapiSecret } from "@/lib/voice/vapi";
import { redactTranscript } from "@/lib/voice/redact";
import {
  DISCLOSURE_MARKERS,
  REVOCATION_PHRASES,
  CONDUCT_VIOLATION_PATTERNS,
  INBOUND_FIRST_MESSAGE,
} from "@/lib/voice/scripts";
import { revokeConsent, recordConsent } from "@/lib/compliance/consent";
import { raiseAlert } from "@/lib/compliance/audit";
import { autoPauseChannel } from "@/lib/flags";
import { getLeadByPhone, createLead } from "@/lib/leads";
import { transition, recordLeadEvent } from "@/lib/lead-machine";
import { businessTimezone } from "@/lib/appointments";
import { localTime } from "@/lib/compliance/tz";
import { toE164US } from "@/lib/phone";
import { captureServerEvent } from "@/lib/posthog-server";

/**
 * POST /api/voice — the Vapi webhook, both directions (replaces the 501 stub).
 *
 * Auth: x-vapi-secret (timing-safe). Dedupe: webhook_events (Vapi retries WILL
 * double-fire). Handles status-update and end-of-call-report; unknown types
 * are acknowledged and ignored.
 *
 * End-of-call responsibilities (docs/automation-platform-spec.md §6.1):
 *  - upsert call_attempts by vapi_call_id (inbound calls create the row and
 *    resolve/create the lead by caller number),
 *  - transcripts pass through redactTranscript BEFORE persistence, always,
 *  - disclosure assertion against the first assistant turn (outbound failure
 *    ⇒ critical alert + auto-pause voice_outbound_ai),
 *  - revocation-phrase scan of customer turns ⇒ revokeConsent in-request,
 *  - conduct scan of assistant turns ⇒ warn alerts, auto-pause at 2 flags/24h,
 *  - PostHog events preserved from the original plan: call_received for every
 *    call and call_quote_captured when quote fields were captured (source 'phone').
 */

/* ── small defensive helpers ─────────────────────────────────────────────── */

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, maxLen = 1000): string {
  return typeof v === "string" ? v.trim().slice(0, maxLen) : "";
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** analysis.structuredData arrives as an object or a JSON string — accept both. */
function parseStructured(v: unknown): Record<string, unknown> {
  if (typeof v === "string") {
    try {
      return obj(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return obj(v);
}

interface Turn {
  role: "assistant" | "customer";
  text: string;
}

/** Conversation turns from artifact.messages, falling back to transcript lines. */
function extractTurns(artifactMessages: unknown, transcript: string): Turn[] {
  const turns: Turn[] = [];
  if (Array.isArray(artifactMessages)) {
    for (const m of artifactMessages) {
      const rec = obj(m);
      const role = str(rec.role, 40).toLowerCase();
      const text = str(rec.message, 10_000) || str(rec.content, 10_000);
      if (!text) continue;
      if (role === "bot" || role === "assistant") turns.push({ role: "assistant", text });
      else if (role === "user" || role === "customer" || role === "human") {
        turns.push({ role: "customer", text });
      }
    }
  }
  if (!turns.length && transcript) {
    for (const line of transcript.split(/\r?\n/)) {
      const a = /^\s*(?:AI|Assistant|Bot|Agent)\s*:\s*(.+)$/i.exec(line);
      if (a) {
        turns.push({ role: "assistant", text: a[1] });
        continue;
      }
      const c = /^\s*(?:User|Customer|Caller|Human)\s*:\s*(.+)$/i.exec(line);
      if (c) turns.push({ role: "customer", text: c[1] });
    }
  }
  return turns;
}

/** endedReason → call_attempts.status. */
function mapEndedReason(reason: string): "completed" | "no_answer" | "voicemail" | "failed" {
  const r = reason.toLowerCase();
  if (r.includes("voicemail")) return "voicemail";
  if (r.includes("customer-ended") || r.includes("assistant-ended")) return "completed";
  if (r.includes("no-answer") || r.includes("did-not-answer")) return "no_answer";
  return "failed";
}

/** After-hours flag for the call_received event (business-local, 8:00–18:00 Mon–Fri). */
function isAfterHours(at: Date): boolean {
  const tz = businessTimezone();
  const { hour } = localTime(tz, at);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(at);
  return weekday === "Sat" || weekday === "Sun" || hour < 8 || hour >= 18;
}

/** 401/503 on auth failure, null when the request may proceed. */
function checkVapiAuth(request: Request): Response | null {
  if (!process.env.VAPI_WEBHOOK_SECRET) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[voice] VAPI_WEBHOOK_SECRET is not set — refusing webhook in production");
      return Response.json({ error: "Webhook secret not configured" }, { status: 503 });
    }
    return null; // dev: accept unauthenticated for local testing
  }
  if (!verifyVapiSecret(request.headers.get("x-vapi-secret"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/* ── route handlers ──────────────────────────────────────────────────────── */

export async function GET() {
  return Response.json({ status: "ready" });
}

export async function POST(request: Request) {
  const authFail = checkVapiAuth(request);
  if (authFail) return authFail;

  let body: Record<string, unknown>;
  try {
    body = obj(await request.json());
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const msg = obj(body.message);
  const type = str(msg.type, 100);
  const call = obj(msg.call);
  const callId = str(call.id, 200);

  if (!type) return Response.json({ ok: true });

  const db = await getDb();
  if (!db) return Response.json({ ok: true, configured: false });

  // Dedupe on (provider, call id + type). status-update fires repeatedly with
  // different statuses for one call, so the status participates in its key.
  const status = str(msg.status, 100);
  const eventId = type === "status-update" ? `${callId}:${type}:${status}` : `${callId}:${type}`;
  if (callId) {
    const res = await db.execute({
      sql: "INSERT OR IGNORE INTO webhook_events (provider, event_id, received_at) VALUES ('vapi', ?, ?)",
      args: [eventId, nowIso()],
    });
    if (res.rowsAffected === 0) return Response.json({ deduped: true });
  }

  try {
    if (type === "status-update") {
      await handleStatusUpdate(callId, status);
    } else if (type === "end-of-call-report") {
      await handleEndOfCallReport(msg, call, callId);
      // Drain the queue right after responding so the founder's call summary
      // and the customer's confirmation go out within seconds of hangup rather
      // than waiting for the next cron tick. after() runs post-response, so
      // Vapi still gets its 200 immediately. Claiming is atomic, so racing the
      // cron is safe; the cron stays the safety net.
      after(async () => {
        try {
          const stats = await drainDueJobs({ limit: 10, budgetMs: 20_000 });
          console.log("[voice] post-call drain:", JSON.stringify(stats));
        } catch (e) {
          console.error("[voice] post-call drain failed:", e);
        }
      });
    }
    // Unknown types: acknowledged, ignored.
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[voice] webhook processing failed:", err);
    // Release the dedupe row so the provider's retry can succeed.
    if (callId) {
      try {
        await db.execute({
          sql: "DELETE FROM webhook_events WHERE provider = 'vapi' AND event_id = ?",
          args: [eventId],
        });
      } catch {
        /* best effort */
      }
    }
    return Response.json({ ok: false, error: "Processing failed" }, { status: 500 });
  }
}

/* ── status-update ───────────────────────────────────────────────────────── */

async function handleStatusUpdate(callId: string, status: string): Promise<void> {
  if (!callId) return;
  const mapped =
    status === "ringing"
      ? "ringing"
      : status === "in-progress" || status === "in_progress"
        ? "in_progress"
        : null;
  if (!mapped) return;
  // Never regress a call that already has a terminal status (out-of-order delivery).
  await q({
    sql: `UPDATE call_attempts SET status = ?
          WHERE vapi_call_id = ? AND status IN ('queued', 'ringing')`,
    args: [mapped, callId],
  });
}

/* ── end-of-call-report ──────────────────────────────────────────────────── */

async function handleEndOfCallReport(
  msg: Record<string, unknown>,
  call: Record<string, unknown>,
  callId: string,
): Promise<void> {
  const now = nowIso();
  const artifact = obj(msg.artifact);
  const analysis = obj(msg.analysis);
  const sd = parseStructured(analysis.structuredData);

  // ── extract the report fields defensively ──
  const endedReason = str(msg.endedReason, 200) || str(call.endedReason, 200);
  const startedAt = str(msg.startedAt, 40) || str(call.startedAt, 40) || null;
  const endedAt = str(msg.endedAt, 40) || str(call.endedAt, 40) || null;
  let durationS = num(msg.durationSeconds);
  if (durationS === null) {
    const ms = num(msg.durationMs);
    if (ms !== null) durationS = Math.round(ms / 1000);
  }
  if (durationS === null && startedAt && endedAt) {
    const span = (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000;
    if (Number.isFinite(span) && span >= 0) durationS = Math.round(span);
  }
  const cost = num(msg.cost);
  const costCents = cost !== null ? Math.round(cost * 100) : null;
  const summaryRaw = str(msg.summary, 4000) || str(analysis.summary, 4000);
  const summary = summaryRaw ? redactTranscript(summaryRaw) : null;
  const rawTranscript = str(artifact.transcript, 200_000) || str(msg.transcript, 200_000);
  const transcript = rawTranscript ? redactTranscript(rawTranscript) : null;
  const recordingUrl =
    process.env.RECORDING_ENABLED === "1"
      ? str(artifact.recordingUrl, 2000) || str(msg.recordingUrl, 2000) || null
      : null;

  const mappedStatus = mapEndedReason(endedReason);
  const turns = extractTurns(artifact.messages, rawTranscript);

  // ── resolve the call row + lead ──
  const existing = callId
    ? await qOne({ sql: "SELECT * FROM call_attempts WHERE vapi_call_id = ?", args: [callId] })
    : null;
  const vapiCallType = str(call.type, 60).toLowerCase();
  const direction: "inbound" | "outbound" = existing
    ? (String(existing.direction) as "inbound" | "outbound")
    : vapiCallType.includes("outbound")
      ? "outbound"
      : "inbound";

  const customerNumber =
    str(obj(call.customer).number, 40) || str(obj(msg.customer).number, 40);
  const phoneE164 = toE164US(customerNumber);

  // Quote-style fields (original plan's slot vocabulary), from structured data.
  const quote = {
    name: str(sd.name, 200),
    business: str(sd.business, 200) || str(sd.business_name, 200) || str(sd.businessName, 200),
    phone: str(sd.phone, 40) || customerNumber,
    email: str(sd.email, 200),
    hoods: str(sd.hoods, 200),
    message: str(sd.message, 2000),
  };
  const quoteCaptured = Boolean(quote.business || quote.name);

  let leadId: string | null = existing?.lead_id ? String(existing.lead_id) : null;
  let leadCreated = false;
  if (!leadId && phoneE164) {
    const found = await getLeadByPhone(phoneE164);
    if (found) {
      leadId = String(found.id);
    } else if (direction === "inbound") {
      const created = await createLead({
        discoverySource: "inbound_call",
        businessName: quote.business || "Unknown caller",
        contactName: quote.name || undefined,
        phone: phoneE164,
        email: quote.email || undefined,
        hoods: quote.hoods || undefined,
        notes: quote.message || undefined,
        status: "engaged",
      });
      if (created && created.id && !created.blocked) {
        leadId = created.id;
        leadCreated = created.created;
      }
    }
  }

  // ── disclosure assertion (first assistant turn) ──
  const firstAssistant = turns.find((t) => t.role === "assistant") ?? null;
  const disclosurePlayed = firstAssistant ? 1 : 0;
  const disclosureVerified =
    firstAssistant &&
    DISCLOSURE_MARKERS.every((m) => firstAssistant.text.toLowerCase().includes(m.toLowerCase()))
      ? 1
      : 0;

  // ── revocation scan of customer turns ──
  let revoked = false;
  let revocationEvidence = "";
  for (const turn of turns) {
    if (turn.role !== "customer" || revoked) continue;
    const lower = turn.text.toLowerCase();
    const phrase = REVOCATION_PHRASES.find((p) => lower.includes(p));
    if (phrase) {
      revoked = true;
      revocationEvidence = (redactTranscript(turn.text) ?? "").slice(0, 300);
    }
  }

  // ── outcome resolution ──
  const OUTCOMES = new Set([
    "booked", "callback_requested", "not_interested", "dnc_request",
    "quote_captured", "opt_out", "emergency_transfer",
  ]);
  const sdOutcome = str(sd.outcome, 60).toLowerCase();
  let outcome: string | null = null;
  if (revoked) outcome = "dnc_request";
  else if (OUTCOMES.has(sdOutcome)) outcome = sdOutcome;
  else if (quoteCaptured) outcome = "quote_captured";

  // ── upsert call_attempts ──
  let callAttemptId: string | null = existing ? String(existing.id) : null;
  if (existing) {
    await q({
      sql: `UPDATE call_attempts SET
              status = ?, outcome = ?, disclosure_played = ?, disclosure_verified = ?,
              recording_url = ?, transcript = ?, summary = ?,
              started_at = ?, ended_at = ?, duration_s = ?, cost_cents = ?
            WHERE vapi_call_id = ?`,
      args: [
        mappedStatus, outcome, disclosurePlayed, disclosureVerified,
        recordingUrl, transcript, summary,
        startedAt, endedAt ?? now, durationS, costCents, callId,
      ],
    });
  } else if (leadId) {
    callAttemptId = crypto.randomUUID();
    await q({
      sql: `INSERT INTO call_attempts (
              id, lead_id, direction, mode, purpose, vapi_call_id,
              consent_tier_snapshot, status, outcome,
              disclosure_played, disclosure_verified,
              recording_url, transcript, summary,
              started_at, ended_at, duration_s, cost_cents, created_at
            ) VALUES (?, ?, ?, 'ai', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        callAttemptId, leadId, direction,
        direction === "inbound" ? "inbound" : null, callId || null,
        mappedStatus, outcome, disclosurePlayed, disclosureVerified,
        recordingUrl, transcript, summary,
        startedAt, endedAt ?? now, durationS, costCents, now,
      ],
    });
    await recordLeadEvent(leadId, "call_attempt", "vapi", {
      direction, vapiCallId: callId || null, status: mappedStatus, outcome,
    });
  }

  // Voicemail cap accounting.
  if (mappedStatus === "voicemail" && leadId) {
    await q({
      sql: "UPDATE leads SET voicemail_count = voicemail_count + 1, updated_at = ? WHERE id = ?",
      args: [now, leadId],
    });
  }

  // ── enrich an existing lead with details captured on THIS call ──
  // COALESCE/NULLIF guards fill email/business/address ONLY when currently
  // empty; a value already on record is never overwritten.
  if (leadId) {
    const address = str(sd.address, 300);
    if (quote.email || quote.business || address) {
      await q({
        sql: `UPDATE leads SET
                email = COALESCE(NULLIF(email, ''), ?),
                business_name = CASE WHEN business_name IN ('', 'Unknown caller')
                  THEN COALESCE(NULLIF(?, ''), business_name) ELSE business_name END,
                address = COALESCE(NULLIF(address, ''), ?),
                updated_at = ?
              WHERE id = ?`,
        args: [quote.email || null, quote.business, address || null, now, leadId],
      });
    }
  }

  // ── outbound disclosure enforcement: fail ⇒ critical alert + auto-pause ──
  if (direction === "outbound" && turns.length > 0 && disclosureVerified === 0) {
    await raiseAlert(
      "critical",
      "disclosure_missing",
      `Outbound AI call ${callId || callAttemptId || "?"} failed the disclosure assertion — voice_outbound_ai auto-paused.`,
      { vapiCallId: callId || null, leadId, firstTurn: firstAssistant?.text.slice(0, 300) ?? null },
    );
    await autoPauseChannel("voice_outbound_ai", "disclosure assertion failed");
  } else if (
    direction === "outbound" &&
    turns.length === 0 &&
    (mappedStatus === "completed" || (durationS ?? 0) >= 15)
  ) {
    // A connected outbound call that yielded ZERO parseable turns means the
    // disclosure monitor couldn't run — most likely a transcript-format change,
    // not a no-answer. Don't fail open silently: flag it for a human to check
    // the assertion still works (warn, not auto-pause, to avoid over-reacting).
    await raiseAlert(
      "warn",
      "disclosure_unverifiable",
      `Outbound AI call ${callId || callAttemptId || "?"} connected (${durationS ?? "?"}s) but no turns were parseable — verify the transcript format and disclosure assertion.`,
      { vapiCallId: callId || null, leadId, durationS },
    );
  }

  // ── in-call revocation ⇒ full FCC pipeline, same request ──
  // Triggered by a matched phrase OR by the assistant reporting a dnc_request
  // outcome in structured data (belt and suspenders — both revoke).
  if (revoked || outcome === "dnc_request") {
    await revokeConsent({
      leadId,
      phoneE164,
      channel: "all",
      source: "voice_request",
      evidence:
        revocationEvidence ||
        `dnc_request outcome reported for call ${callId || callAttemptId || "?"}`,
    });
    revoked = true;
  }

  // ── conduct scan of assistant turns ──
  let conductHits = 0;
  for (const turn of turns) {
    if (turn.role !== "assistant") continue;
    for (const p of CONDUCT_VIOLATION_PATTERNS) {
      if (p.pattern.test(turn.text)) {
        conductHits += 1;
        await raiseAlert(
          "warn",
          "conduct_violation",
          `${p.kind}: "${(redactTranscript(turn.text) ?? "").slice(0, 200)}"`,
          { vapiCallId: callId || null, leadId, kind: p.kind },
        );
      }
    }
  }
  if (conductHits > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const row = await qOne({
      sql: "SELECT COUNT(*) AS n FROM admin_alerts WHERE kind = 'conduct_violation' AND at >= ?",
      args: [since],
    });
    if (row && Number(row.n) >= 2) {
      await autoPauseChannel("voice_outbound_ai", "2 conduct flags in 24h");
    }
  }

  // ── founder call-summary notification (one per call) ──
  const founderAddr = process.env.FOUNDER_EMAIL;
  if (founderAddr && (turns.length > 0 || (durationS ?? 0) >= 5)) {
    const apptRow = leadId
      ? await qOne({
          sql: "SELECT kind, starts_at FROM appointments WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1",
          args: [leadId],
        })
      : null;
    await enqueue({
      type: "send_email",
      leadId: leadId ?? undefined,
      idempotencyKey: `callnotify:${callId || callAttemptId || crypto.randomUUID()}`,
      payload: {
        template: "call_summary",
        phone: quote.phone || phoneE164 || "", direction, outcome, intent: str(sd.intent, 40),
        durationS, name: quote.name, business: quote.business, email: quote.email,
        address: str(sd.address, 300), hoods: quote.hoods,
        summary, transcript: (transcript || "").slice(0, 12000),
        apptKind: apptRow ? String(apptRow.kind) : "", apptStartsAt: apptRow ? String(apptRow.starts_at) : "",
      },
    });
  }

  // ── PostHog telemetry (original plan's event vocabulary, preserved) ──
  const startedDate = startedAt ? new Date(startedAt) : new Date();
  const intent =
    str(sd.intent, 60) ||
    (outcome === "emergency_transfer"
      ? "emergency"
      : quoteCaptured
        ? "quote"
        : outcome === "callback_requested"
          ? "callback"
          : "unknown");
  await captureServerEvent("call_received", {
    intent,
    after_hours: isAfterHours(startedDate),
    duration: durationS ?? 0,
    source: "phone",
    direction,
  });
  if (quoteCaptured) {
    await captureServerEvent("call_quote_captured", {
      name: quote.name,
      business: quote.business,
      phone: quote.phone,
      email: quote.email,
      hoods: quote.hoods,
      message: quote.message,
      source: "phone",
    });
  }

  // ── inbound lead lifecycle ──
  if (direction === "inbound" && leadId && !revoked) {
    // An inbound call from a known cold/contacting lead re-engages them.
    if (!leadCreated) {
      try {
        await transition(leadId, "engaged", "vapi", { via: "inbound_call", vapiCallId: callId });
      } catch {
        /* lead is past engaged (e.g. appointment_scheduled) — fine */
      }
    }
    // The caller volunteered their number and asked us to follow up:
    // record express consent with the exact disclosure the assistant plays.
    if (quoteCaptured || outcome === "callback_requested" || outcome === "booked") {
      try {
        await recordConsent({
          leadId,
          tier: "express",
          source: "inbound_call",
          disclosureText: INBOUND_FIRST_MESSAGE,
          rawPayload: { vapiCallId: callId || null },
        });
      } catch (err) {
        console.error("[voice] recordConsent failed:", err);
      }
    }
  }

  // ── outcome side effects ──
  // booked      → handled by the /api/vapi/tools book_appointment route
  // dnc_request → revocation already executed above
  if (outcome === "callback_requested" && leadId) {
    const preferred = str(sd.callback_time, 200) || str(sd.preferredTime, 200);
    await recordLeadEvent(leadId, "note", "vapi", { callback: preferred || "unspecified" });
  } else if (outcome === "not_interested" && leadId) {
    try {
      await transition(leadId, "lost", "vapi", { reason: "not_interested", vapiCallId: callId });
    } catch {
      /* transition not legal from current status — tolerated */
    }
  }
}
