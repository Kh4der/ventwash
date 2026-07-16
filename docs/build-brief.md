# Build brief — automation platform implementation

Shared contract sheet for implementers. Read alongside
[automation-platform-spec.md](automation-platform-spec.md) (authoritative design).

## Next.js 16.2.10 rules (this version differs from your training data)

- `params`/`searchParams` in pages AND route handlers are **Promises** — always
  `await params`. Route handler: `export async function GET(request: Request, { params }: { params: Promise<{ token: string }> })`.
- `cookies()` / `headers()` from `next/headers` are **async** — `await cookies()`.
- Route handlers are **not cached by default**; no config needed for dynamic.
- Use plain `Request` / `Response.json(...)` like the existing routes.
- `after()` from `next/server` schedules post-response work in route handlers.
- No middleware needed anywhere in this build (it's renamed `proxy.ts` in v16 anyway — don't add one).
- Client components: `"use client"` at top; can't be async.
- Node 20+; Turbopack is the default bundler. Do NOT add webpack config.

## House style

- 2-space indent, double quotes, semicolons; JSDoc-style header comment per file
  explaining the module's role.
- Minimal dependencies: **no new npm packages** — providers are raw `fetch()`.
  The only runtime dep added by this build is `@libsql/client` (already installed).
- All UI uses inline styles with the site constants:
  `INK #1a2129`, `ACCENT/BLUE #3E6FA6`, `BODY #414c57`, bg `#f3f8fb`,
  `MONO 'IBM Plex Mono',monospace`, `HEAD 'Archivo',sans-serif`,
  `SERIF 'Instrument Serif',serif`, `CARD_BORDER 1px solid rgba(26,33,41,.1)`.
  Look at `src/components/quote/QuoteModal.tsx` and `src/components/admin/Dashboard.tsx` for the idiom.
- Defensive parsing everywhere (see `src/app/api/quote/route.ts`): never trust
  a request body; clamp string lengths; try/catch JSON.
- Analytics: server-side via `captureServerEvent(event, props, distinctId?)`
  from `src/lib/posthog-server.ts` — fire-and-forget telemetry only.

## Kernel contracts (already implemented — import, don't reimplement)

### `@/lib/db`
- `getDb(): Promise<Client | null>` — null ⇒ unconfigured; return `{ configured: false }` from admin APIs, skip side effects elsewhere.
- `q(stmt): Promise<Row[]>`, `qOne(stmt): Promise<Row | null>`, `tx(stmts): Promise<void>` — stmt is `string | { sql, args }`. Rows are `Record<string, unknown>` — cast with `String()/Number()`.
- `nowIso()`, `getSetting(key)`, `setSetting(key, value)`.

### `@/lib/jobs`
- `enqueue({ type, payload?, leadId?, runAt?, idempotencyKey?, maxAttempts? }): Promise<string | null>`
- `claimDueJobs(limit?): Promise<Job[]>` (reaps stale locks first)
- `completeJob(id, simulated?)`, `failJob(job, error)` (backoff/dead-letter), `blockJob(id, reason)`,
  `cancelByKeyPrefix(prefix)`, `cancelJobsForLead(leadId)`
- `Job = { id, type, payload: Record<string, unknown>, lead_id, status, run_at, attempts, max_attempts, idempotency_key, simulated }`

### `@/lib/job-handlers` (registry — already written)
Each handler file exports `run(job: Job): Promise<HandlerResult>`;
`HandlerResult = { simulated?: boolean; blocked?: string } | void`; throw ⇒ retry.

### `@/lib/lead-machine`
- `transition(leadId, to, actor, meta?)` — throws `IllegalTransitionError` (surface as 422) / Error when lead missing.
- `recordLeadEvent(leadId, type, actor, meta?)`, `isTransitionAllowed(from, to)`.
- Statuses: discovered, enriched, review_queue, approved_outreach, contacting, engaged, appointment_scheduled, won_pending_onboarding, onboarded, inspection_scheduled, customer, lost, do_not_contact.

### `@/lib/leads`
- `createLead(input: NewLead): Promise<{ id, created, blocked? } | null>` — handles dedupe + tombstones. Inbound sources pass `status: "engaged"`.
- `getLead(id)`, `getLeadByPhone(e164)`, `updateLeadFields(id, fields)` (whitelisted), `deleteLead(id, actor)` (privacy cascade).

### `@/lib/phone`
- `toE164US(input): string | null`, `formatUS(e164)`, `areaCode(e164)`.

### `@/lib/flags`
- `isChannelEnabled(channel)`, `listChannelFlags()`, `setChannelFlag(channel, enabled, updatedBy)`, `autoPauseChannel(channel, reason)`.
- Channels: voice_outbound_ai, voice_outbound_bridge, sms, email_transactional, email_cold, crawler, discovery.

### `@/lib/compliance/*`
- `consent.ts`: `recordConsent({ leadId, tier, channelScope?, source, ip?, formUrl?, disclosureText, rawPayload? })`,
  `revokeConsent({ leadId?, phoneE164?, email?, channel?, source, evidence, actor? })` (full FCC pipeline: DNC insert, tier reset, job cancellation),
  `isRevoked(lead, channel)`, `latestConsentEvent(leadId, withinDays?)`.
- `tcpa.ts`: `canPlaceAiCall(lead: LeadForCall, purpose, { appointmentId? })` and `canPlaceBridgeCall(lead)` → `{ allowed, reason?, basis?, meta }`. They write their own audit rows on refusal. `LeadForCall` needs: id, phone_e164, consent_tier, approval, phone_line_type, line_type_checked_at, timezone, region, status, voicemail_count.
- `dnc.ts`: `isInternalDnc`, `addInternalDnc(phone, reason, addedBy)`, `isNationalDnc`, `dncFreshness()`.
- `quiet-hours.ts`: `checkQuietHours({ timezone, region })`, `maxAttemptsPer24h(region)`.
- `tz.ts`: `resolveTimezone({ postal?, region?, phone_e164? })` — call this when creating/enriching leads to populate `leads.timezone`.
- `audit.ts`: `writeAudit({ actor, action, leadId?, channel?, consentTier?, payload?, meta? })`, `raiseAlert(severity, kind, message, meta?)`, `sha256(s)`.

### Choke points (the ONLY way to touch the outside world)
- `@/lib/email/send`: `sendEmail({ leadId?, jobId?, kind: 'transactional'|'cold'|'internal', template, to, subject, html, replyTo?, attachments? })` → `{ messageId, status: 'sent'|'blocked'|'skipped_unconfigured', blockReason? }`. Cold emails must contain `CANSPAM_MARKERS.unsubscribe` (`/api/unsubscribe?token=`) and `CANSPAM_MARKERS.postalAttr` (`data-vw-postal="1"`).
- `@/lib/sms`: `sendSms({ leadId, jobId?, kind: 'transactional'|'marketing', template, to, body })` → same result shape.
- `@/lib/voice/vapi`: `placeOutboundAiCall(lead, purpose, basis, jobId)` — ONLY callable after `canPlaceAiCall` passed. Also `verifyVapiSecret(header)`, `getCallByVapiId(id)`, `deleteVapiCallArtifacts(id)`, `vapiConfigured()`.
- `@/lib/voice/bridge`: `placeBridgeCall(lead, foundedBy)` — ONLY after `canPlaceBridgeCall`; `signBridgeParam(leadId)` / `verifyBridgeParam(leadId, sig)` for the TwiML callback.
- `@/lib/voice/scripts`: SCRIPTS_VERSION, INBOUND_FIRST_MESSAGE, OUTBOUND_FIRST_MESSAGE, VOICEMAIL_SCRIPT, RECORDING_DISCLOSURE, DISCLOSURE_MARKERS, REVOCATION_PHRASES, CONDUCT_VIOLATION_PATTERNS.
- `@/lib/voice/redact`: `redactTranscript(text)` — MUST run before persisting any transcript.

### Scheduling & onboarding
- `@/lib/appointments`: `createAppointment`, `confirmAppointment`, `rescheduleAppointment`, `cancelAppointment`, `completeAppointment(id, actor, 'completed'|'no_show')`, `getAppointment`, `getAvailableSlots(days?)`, `hasOverlap`, `fanOutReminders`, `businessTimezone()`. Reminder job keys: `appt:<id>:<seq>:{confirm_email|email_48h|sms_24h|call_4h}`.
- `@/lib/onboarding`: `issueOnboardingForm(leadId, actor)` → `{ formId, token, url }`; `getFormByToken(raw)`, `markFormOpened(id)`, `submitOnboarding(rawToken, input)`, `sanitizeOnboardingData(input)`.
- `@/lib/ics`: `buildIcsEvent({ uid, sequence, startsAt, endsAt, summary, description?, location?, method? })`, `buildIcsCalendar(events)`.
- `@/lib/link-tokens`: `createLinkToken('appointment'|'unsubscribe', subjectId, ttlMs)`, `verifyLinkToken(purpose, token)`, `siteBaseUrl()`.

### Job payload contracts
- `send_email`: `{ template, leadId?, appointmentId?, onboardingUrl?, nudge? }` + `job.lead_id`. Templates: quote_ack, appointment_confirm (attach ICS), appointment_reminder_48h, onboarding_invite, onboarding_confirm, founder_onboarding_notify, cold_intro, daily_digest.
- `send_sms`: `{ template: 'appointment_reminder_24h', appointmentId }`.
- `place_ai_call`: `{ purpose: 'quote_followup'|'appointment_confirmation'|'marketing', appointmentId? }` + `job.lead_id`.
- `crawl_site`: `{ leadId }`; `score_lead`: `{ leadId }`; `lookup_line_type`: `{ leadId }`.
- `onboarding_nudge`: `{ leadId, onboardingUrl, nudge: 1|2 }`.

### Admin auth (existing — reuse verbatim)
```ts
const cookieStore = await cookies();
if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
```
from `@/lib/admin-auth`.

### Cron auth
`Authorization: Bearer ${CRON_SECRET}` — when CRON_SECRET is unset, allow
only in non-production (`process.env.NODE_ENV !== 'production'`).

## Non-negotiables
- Compliance gates run BEFORE the configured/unconfigured provider check.
- Nothing dials/sends outside the choke points; no new code path may place
  a call or send a message directly.
- Append-only tables (consent_events, revocations, dnc_internal, audit_log,
  lead_events, crawl_log, tombstones): INSERT only, ever.
- No Google Places / Yelp clients anywhere.
- `three@0.128` and everything under `src/components/experience/` untouched.
- The existing PostHog analytics (`/api/admin/stats`, Analytics tab) stays byte-identical.
