# VentWash Automation Platform — Final Architecture Specification

**Version:** 1.0 (synthesis of the three-proposal design competition, judge panel verdicts, and the mandatory compliance guardrails)
**Repo:** `D:\KITCHENHOOD` — Next.js 16.2.10 App Router, React 19, TypeScript, deployed to Vercel (any Node host must keep working)
**Base architecture:** the **"pipeline"** proposal (unanimous 3–0 judge winner), amended with judge-mandated compliance fixes and grafts from "minimalist" and "integrator".

**Build note for implementers:** per `AGENTS.md`, this Next.js version is post-training-cutoff — read the relevant guides in `node_modules/next/dist/docs/` before writing any route/page code. The repo's existing routes are the proven idiom reference: `await cookies()` (async, see `src/app/api/admin/stats/route.ts:14`), plain `Request`/`Response.json` handlers, `verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)` auth guard. The Three.js r128 homepage experience is untouchable: no dependency changes that touch `three@0.128`, no shared components with the experience bundle; all new UI lives under `/admin`, `/onboard`, `/appointment`, `/bot`, `/privacy`.

**Core doctrine (from the winning proposal, hardened by the guardrails):**

1. **One state machine.** The whole business is an explicit lead lifecycle persisted in libSQL. Leads only change state through one `transition()` function that validates edges and writes an append-only audit row.
2. **Everything is a job.** No side effect (email, SMS, AI call, crawl, nudge) executes outside a durable `jobs` outbox row drained by one idempotent cron worker. Webhooks and forms only mutate state and enqueue.
3. **One choke point per channel.** `canPlaceAiCall()`, `canPlaceBridgeCall()`, `sendEmail()`, `sendSms()` are the only code paths that touch the outside world. There is exactly one place to audit per channel, and every one of them **fails closed**: missing env, missing DB, stale DNC data, unknown timezone, unknown line type → no send, ever. This deliberately inverts the site's "no-op gracefully" philosophy in the safe direction only (a skipped send is safe; an unchecked send is not).
4. **PostHog is telemetry, never truth.** Every lifecycle event still emits through the existing `captureServerEvent()` (`src/lib/posthog-server.ts`) so the analytics dashboard keeps working; operational decisions read only the DB.
5. **Consent, DNC, revocations, and audit rows are append-only and immortal.** They are the company's defense record in any TCPA/CAN-SPAM demand letter and are exempt from retention deletion.

---

## 1. Decision Log

| # | Decision | Chosen over | Rationale |
|---|----------|-------------|-----------|
| D1 | **Base architecture: "pipeline"** (jobs outbox + state machine + single cron worker) | "minimalist" (fewest deps, but ad-hoc side effects), "integrator" (rented services, webhook glue) | Unanimous judge winner. Only proposal treating serverless failure modes as first-class: atomic job claiming, `idempotency_key` uniqueness (double cron fires are no-ops), stale-lock reaper (functions killed mid-invocation — the failure mode the other two missed), dead-lettering with admin retry, `webhook_events` dedupe (Vapi retries WILL double-fire), dead-man heartbeat via daily digest. At week six, a 2-founder team debugs this from the Jobs panel instead of five vendor dashboards. |
| D2 | **Data layer: `@libsql/client`** — `file:./data/ventwash.db` in dev, Turso in prod. Raw SQL, hand-rolled ~60-line migration runner, no ORM. | (a) better-sqlite3, (c) Postgres/Neon + Prisma/Drizzle, (d) Vercel KV/blob hacks | (a) is a node-gyp native module — build pain on the Windows 11 dev box and **structurally useless on Vercel**: serverless filesystems are ephemeral, so a local `.db` silently loses rows between invocations — and losing *consent records* is itself a compliance failure, not just data loss. (c) works but forces a cloud connection string even for local dev (breaks the README's "works with zero env vars" promise) and Prisma/Drizzle's codegen toolchain outsizes this repo's entire 8-dependency `package.json`. (b) is one package, prebuilt win32-x64 binding (no compile step), speaks `file:` locally (fully offline dev) and `libsql://` over pure HTTPS to Turso in prod (no native-module problem in functions, no connection-pool problem, encrypted at rest, PITR, free tier covers a 2-founder shop at $0). Plain SQLite dialect keeps everything portable — to Postgres later, or to Node's built-in `node:sqlite` locally. **Escape hatches (documented in `db.ts`):** if the win32 prebuilt ever lags a Node major, dev falls back to `turso dev` (local HTTP server) or `node:sqlite` behind the same query-helper interface; only `db.ts` imports the driver. **Fail-safe (minimalist graft):** `getDb()` detects `VERCEL=1` with Turso vars missing and returns `null` → every DB route returns the `{ configured: false }` shape `/api/admin/stats` already uses; a `file:` DB is never opened on serverless. **Turso config:** single primary region, default (consistent) client — avoids replica-lag double-sends from the reminder worker. |
| D3 | **Voice platform: Vapi for both directions** (inbound assistant + outbound assistant), number **owned in Twilio** and imported into Vapi | Retell, DIY (Twilio Media Streams + Deepgram + Claude + ElevenLabs), running two voice stacks | Aligns with the existing `docs/voice-automation-plan.md`, which already compared these and picked Vapi. Outbound is one authenticated `POST https://api.vapi.ai/call`; both directions emit into the single `POST /api/voice` webhook the 501 stub already reserves — one platform, one secret, one conversation-design skillset. Twilio number ownership keeps the number portable if Vapi is ever swapped; the DIY path remains the documented >2,000 min/mo escape hatch because the webhook contract is platform-agnostic. |
| D4 | **Calendar: DB-native appointments + hand-rolled ICS (~60 lines) + read-only `calendar.ics` subscribe feed** | Cal.com (integrator's pick), Calendly, Google Calendar OAuth | The judges split here; ruling: appointments are rows in **our** database and calendars are projections of that state, never the reverse. Cal.com creates a second source of truth the state machine must chase via webhooks — two judges flagged that one missed/out-of-order `BOOKING_RESCHEDULED` silently drifts the reminder engine, and integrator shipped no reconciliation sweep. RFC 5545 VEVENT generation is trivial text; `ics_sequence` bumps on reschedule so Google/Outlook/Apple update the event in place. Founders subscribe via the key-authed read-only feed (minimalist graft) — zero OAuth, no token refresh, no consent screens. If two-way sync is ever truly needed, a Google service-account handler slots in as one more job type without schema change. |
| D5 | **Telephony/SMS: Twilio via raw `fetch`** (Messages API, Lookup v2, Calls API for click-to-dial bridge). No `twilio` npm package. | Vonage, Vapi-native numbers, the 10MB Twilio SDK | Sending SMS is ~15 lines of fetch + Basic auth. Twilio Lookup v2 `line_type_intelligence` is the compliance keystone (wireless gate). Twilio Calls API powers the human click-to-dial bridge (D8). A2P 10DLC brand+campaign registration is a launch-gate console task before `SMS_ENABLED` is ever set. |
| D6 | **Email: Resend via raw `fetch`, + svix-signed delivery webhooks** (integrator graft) | Postmark ($15/mo floor), SDK usage | One JSON POST; 3k emails/mo free tier dwarfs this volume. Delivery webhooks (delivered/bounced/complained) feed `messages.status` so the admin UI shows whether a reminder actually *landed*, and bounces/complaints auto-populate `email_suppressions` — the winning proposal logged sends but never learned their fate. Postmark is the fallback if deliverability degrades. **Deliverability runbook (integrator graft):** SPF/DKIM/DMARC on day one; warm the domain on high-engagement transactional traffic first; cold email **never** shares the transactional domain — it sends from a separate subdomain (D9). |
| D7 | **Discovery sources: OSM Overpass + CSV import + county health-department open data + businesses' own websites. Google Places and Yelp are excluded at the schema level.** | Google Places (best data), Yelp Fusion | Google Maps Platform ToS prohibits caching/storing Places data and building lead lists from it; Yelp Fusion similarly. This is contract/account risk, not gray area — so `leads.discovery_source` has a CHECK constraint with **no** `google`/`yelp` value and the repo ships no client for either (dependency review enforces). Overpass is free and ODbL-compatible for internal use with attribution (rendered in the admin UI). Health-department restaurant license/inspection lists are public records — the ideal source: accurate, no ToS, and hood-violation flags double as lead scoring. |
| D8 | **Cold leads (`consent_tier='none'`) can NEVER be AI-dialed. The only system-mediated call to a cold lead is a founder click-to-dial bridge (Twilio bridges the founder's own phone to the lead; a human speaks, no AI, no prerecorded audio), restricted to verified business landlines/fixed-VoIP, after per-lead founder approval.** | All three proposals' final phases (each ended in a Vapi AI call to "approved cold landlines") | Judge-mandated, all three panels. FCC's Feb 2024 declaratory ruling makes AI voices "artificial or prerecorded" under TCPA §227; there is no B2B exemption for robocalls to wireless, and wireless-vs-landline is only probabilistically knowable. `canPlaceAiCall()` therefore has **no override path** for tier `none` — not an admin flag, not an approval click. The approval machinery from the winning proposal is retained but its terminal action is changed to the human bridge. |
| D9 | **Cold email stays in scope** (vs. integrator's ban), under CAN-SPAM opt-out mechanics with hard rails: per-address `source_url` provenance required, no-harvest heuristic, `MAX_COLD_EMAILS_PER_DAY` (default 50), separate `outreach.` subdomain, postal-address + one-click unsubscribe partials enforced at build time and runtime, per-lead founder approval required. | Integrator's "no cold email at all" | One judge observed that banning the guardrails' *preferred safe channel* funnels cold leads toward the riskiest one (phones). Cold email is the legally-designed pressure valve; the guardrails make it compliant, so we ship it — small, provenance-tracked, human-released. |
| D10 | **Kill switches live in a `channel_flags` DB table (all default OFF), toggled from the admin dashboard** — not env vars. | Winning proposal's `OUTBOUND_CALLING_ENABLED` env var | Judge-mandated (integrator graft + guardrails' `channel_flags` requirement): either founder must be able to pause a misbehaving channel instantly from a phone, without a Vercel redeploy. Env vars remain only as *provider configuration* (their absence is an additional fail-closed layer). Non-durable DB ⇒ `channelFlags.allOff()` in code. |
| D11 | **Quiet hours are computed in the RECIPIENT's local time** (ZIP-prefix → IANA tz table, area-code fallback), **fail closed on unknown**, with a versioned `state-rules.ts` table (FL, OK, WA, MD, CT at minimum) applying the strictest rule. | All three proposals (business-TZ quiet hours) | Judge-mandated guardrail fix. `leads.timezone IS NULL` ⇒ the dialer/SMS worker skips with reason `tz_unknown`. Default window 8:00–21:00 recipient-local; FL 8:00–20:00 + max 3 attempts/24h; the table ships in code (git-reviewed, counsel-reviewable) not DB. |
| D12 | **`dnc_internal` is append-only in-app** — no DELETE endpoint exists; removals require direct DB access with a logged reason. | Minimalist's `DELETE /api/admin/dnc` | Judge-mandated. Internal DNC is honored indefinitely and overrides any consent record. |
| D13 | **National DNC sync ships as a weekly job** (`dnc_sync`): FTC SAN subscription (`DNC_SAN`), change-lists into `dnc_national`, `settings.dnc_synced_at`; **any telemarketing dial without a recorded consent/EBR exception is blocked when data is missing or >31 days old — campaign-wide fail-closed.** No proposal shipped this. | Deferring to a risk footnote | Hard-block requirement. Ruling on exceptions: an AI `quote_followup` call within 90 days of the lead's own inquiry carries a **recorded** `inquiry_ebr` exception (the `consent_events` row) and may proceed without registry data; `marketing` calls and all cold bridge dials require fresh registry data, full stop — meaning cold calling through the system is impossible until the founders buy the SAN subscription. Exception basis is snapshotted on every call row. |
| D14 | **Consent vocabulary: `consent_tier IN ('none','express','express_written')`** + append-only `consent_events` with the verbatim disclosure text rendered at capture time. | Proposals' `consent_basis` variants | The guardrails define this as a hard schema constraint; their naming wins. The quote form gains an **optional, unchecked-by-default** checkbox with E-SIGN-compliant language naming VentWash and automated/AI calls & texts → `express_written`. Submitting the form without the checkbox still yields `express` (they volunteered the number for the quote purpose), which lawfully permits the informational AI quote-callback but nothing promotional. |
| D15 | **Cron: single worker endpoint** `GET /api/cron/tick` (+ `?task=` enqueue-only variants) | Integrator's three separate cron routes | One drain loop, one auth check, one time budget, one place to reason about concurrency. All *timing* lives in `jobs.run_at`, so schedule granularity is a delivery-latency knob, not a correctness knob — Hobby-plan/external-pinger degradation is safe by construction. |
| D16 | **Crawler: hand-rolled (robots.txt, per-domain politeness ledger, `crawl_log`), with Apify's contact-scraper actor documented as a drop-in fallback** inside the `crawl_site` handler if JS-rendered sites defeat regex extraction. | Apify-first (integrator) | Hand-rolled matches house style and keeps the audit trail (`crawl_log`) first-party; Apify remains a config swap, not a redesign (judge graft). Public `/bot` transparency page ships with the crawler and is linked from the User-Agent (minimalist graft). |
| D17 | **`discovery_source` CHECK extended with `'manual'`** beyond the guardrails' literal list | Guardrails' exact 6-value list | Founders meet restaurant owners in person; forcing business-card leads through `csv_import` would falsify provenance — the exact thing provenance exists for. `'manual'` requires a non-empty `provenance_note`. The load-bearing property — no `google`, no `yelp` — is preserved. |
| D18 | **Speed-to-lead: fresh quote-form submissions get an AI callback within ~5 minutes** (minimalist graft), purpose `quote_followup` under tier `express`. | Waiting for the outbound phase's slower cadence | Highest-converting single automation in the plan; the consent trail exists the moment the form is submitted. Gated like every call: flags, revocation, quiet hours, line-type lookup first. |
| D19 | **Line-type Lookup runs at lead creation/import time** (enqueued `lookup_line_type` job), stored with `line_type_checked_at`, re-checked when >90 days; UI disables call affordances for wireless cold leads outright. | Winning proposal's approve-time-only check | Integrator graft, judge-mandated: fail closed earlier in the funnel; satisfies the 90-day re-check guardrail. |
| D20 | **PostHog untouched; one-time backfill script** copies historical `quote_submitted` events into `leads`. | Migrating analytics into the DB | The `/admin` Analytics tab keeps reading HogQL exactly as today. Convention documented in code: **DB rows are canonical for state; PostHog events are fire-and-forget telemetry emitted from the same code paths; never read PostHog to make an operational decision.** The Pipeline tab is authoritative for lead counts. |
| D21 | **Recording default OFF** (`RECORDING_ENABLED` unset = no recording); all-party consent posture nationwide; retention cron hard-deletes at the provider after `RECORDING_RETENTION_DAYS` (90). | Recording-on defaults | Hard block: no audio before the disclosure plays; disclosure is a repo constant verified against live Vapi config by `npm run verify:voice-config` in CI. Warm transfers to founder cells set recording OFF at transfer. |

---

## 2. Database Schema (libSQL / SQLite dialect)

Conventions: ids are `crypto.randomUUID()` TEXT unless AUTOINCREMENT; all timestamps are ISO-8601 UTC TEXT; JSON blobs are TEXT. Migrations are numbered `.sql` files in `src/db/migrations/`, applied in a transaction by the runner and tracked in `_migrations`. Append-only tables (`consent_events`, `revocations`, `dnc_internal`, `audit_log`, `lead_events`, `crawl_log`, `tombstones`) have **no UPDATE/DELETE code paths in the app** and are exempt from the retention cron.

```sql
-- ============================================================
-- 0001_core.sql — spine: leads, consent, jobs, flags, audit
-- ============================================================

CREATE TABLE _migrations (
  id INTEGER PRIMARY KEY,             -- migration number
  applied_at TEXT NOT NULL
);

CREATE TABLE leads (
  id                  TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN (
                        'discovered','enriched','review_queue','approved_outreach',
                        'contacting','engaged','appointment_scheduled',
                        'won_pending_onboarding','onboarded','inspection_scheduled',
                        'customer','lost','do_not_contact')),
  discovery_source    TEXT NOT NULL CHECK (discovery_source IN (
                        'osm','csv_import','own_website','gov_open_data',
                        'inbound_form','inbound_call','manual')),   -- NO google/yelp value exists (D7/D17)
  provenance_note     TEXT,               -- REQUIRED (app-enforced) when discovery_source='manual'
  business_name       TEXT NOT NULL,
  contact_name        TEXT DEFAULT '',
  phone_e164          TEXT,
  phone_line_type     TEXT,               -- 'landline'|'mobile'|'fixedVoip'|'nonFixedVoip'|'tollFree'|'unknown'|NULL
  line_type_checked_at TEXT,              -- re-check when older than 90 days
  email               TEXT,
  website             TEXT,
  address TEXT, city TEXT, region TEXT, postal TEXT,
  lat REAL, lng REAL,
  timezone            TEXT,               -- IANA; ZIP-prefix map, area-code fallback; NULL ⇒ NO calls/SMS (fail closed)
  cuisine             TEXT DEFAULT '',    -- OSM tag; feeds grease-load scoring
  hoods               TEXT DEFAULT '',
  notes               TEXT DEFAULT '',
  score               INTEGER NOT NULL DEFAULT 0,
  consent_tier        TEXT NOT NULL DEFAULT 'none'
                        CHECK (consent_tier IN ('none','express','express_written')),
  approval            TEXT NOT NULL DEFAULT 'not_required'
                        CHECK (approval IN ('not_required','pending','approved','rejected')),
  approved_by         TEXT,
  approved_at         TEXT,
  call_attempt_count  INTEGER NOT NULL DEFAULT 0,
  last_call_at        TEXT,
  voicemail_count     INTEGER NOT NULL DEFAULT 0,
  posthog_distinct_id TEXT,
  osm_id              TEXT,
  dedupe_key          TEXT NOT NULL,      -- first non-empty of: phone_e164 | lower(email) | host(website) | slug(name+geohash)
  deleted_at          TEXT                -- privacy deletion marker; PII columns nulled, excluded from all queries
);
CREATE UNIQUE INDEX leads_dedupe ON leads(dedupe_key) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX leads_osm    ON leads(osm_id) WHERE osm_id IS NOT NULL;
CREATE INDEX leads_status ON leads(status);
CREATE INDEX leads_phone  ON leads(phone_e164) WHERE phone_e164 IS NOT NULL;

-- Append-only audit/timeline. Never UPDATE/DELETE.
CREATE TABLE lead_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     TEXT NOT NULL REFERENCES leads(id),
  at          TEXT NOT NULL,
  type        TEXT NOT NULL,   -- 'created'|'transition'|'call_attempt'|'email_sent'|'sms_sent'|'approval'|
                               -- 'consent'|'revocation'|'crawl'|'blocked'|'note'|'deletion'
  from_status TEXT,
  to_status   TEXT,
  actor       TEXT NOT NULL,   -- 'system'|'admin'|'vapi'|'customer'|'cron'
  meta        TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX lead_events_lead ON lead_events(lead_id, at);

-- Append-only consent evidence (E-SIGN trail). Never UPDATE/DELETE; PII redaction only via deleteLead.
CREATE TABLE consent_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id         TEXT NOT NULL REFERENCES leads(id),
  tier            TEXT NOT NULL CHECK (tier IN ('express','express_written')),
  channel_scope   TEXT NOT NULL DEFAULT 'all' CHECK (channel_scope IN ('all','voice','sms','email')),
  captured_at     TEXT NOT NULL,
  source          TEXT NOT NULL,       -- 'quote_form'|'inbound_call'|'onboarding_form'|'manual_documented'
  ip              TEXT,
  form_url        TEXT,
  disclosure_text TEXT NOT NULL,       -- VERBATIM disclosure/checkbox language rendered at capture time
  raw_payload     TEXT NOT NULL DEFAULT '{}'
);

-- Append-only revocations (FCC Apr-2025 rules: any reasonable means, honored immediately).
CREATE TABLE revocations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id    TEXT REFERENCES leads(id),
  phone_e164 TEXT,
  email      TEXT,
  channel    TEXT NOT NULL DEFAULT 'all' CHECK (channel IN ('all','voice','sms','email')),
  source     TEXT NOT NULL,            -- 'sms_stop'|'voice_request'|'email_unsubscribe'|'admin'|'complaint'
  evidence   TEXT NOT NULL,            -- verbatim message / transcript excerpt / URL
  revoked_at TEXT NOT NULL
);

-- Write-once internal DNC. NO delete endpoint exists in the app (D12).
CREATE TABLE dnc_internal (
  phone_e164 TEXT PRIMARY KEY,
  reason     TEXT NOT NULL,            -- 'requested_on_call'|'sms_stop'|'admin'|'complaint'|'deletion_request'
  added_by   TEXT NOT NULL,
  added_at   TEXT NOT NULL
);

CREATE TABLE email_suppressions (
  email    TEXT PRIMARY KEY,
  reason   TEXT NOT NULL,              -- 'unsubscribe'|'hard_bounce'|'complaint'|'admin'|'deletion_request'
  source   TEXT NOT NULL,              -- 'link'|'resend_webhook'|'admin'|'delete_lead'
  added_at TEXT NOT NULL
);

-- Privacy tombstones: sha256 of each normalized identifier of a deleted lead;
-- discovery/import refuses to re-create a lead matching any tombstone.
CREATE TABLE tombstones (
  hash       TEXT PRIMARY KEY,         -- sha256(phone_e164 | lower(email) | host(website))
  created_at TEXT NOT NULL
);

-- The durable outbox. The ONLY place side effects originate.
CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,       -- 'send_email'|'send_sms'|'place_ai_call'|'lookup_line_type'|
                                       -- 'discover_osm'|'crawl_site'|'score_lead'|'onboarding_nudge'|
                                       -- 'daily_digest'|'dnc_sync'|'retention_sweep'|'heartbeat'
  payload         TEXT NOT NULL DEFAULT '{}',
  lead_id         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                    'pending','running','done','failed','dead','cancelled','blocked')),
  run_at          TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  idempotency_key TEXT UNIQUE,         -- e.g. 'sms:appt_24h:<apptId>:<seq>' — re-enqueue is a no-op
  locked_at       TEXT,
  last_error      TEXT,
  block_reason    TEXT,                -- compliance reason code when status='blocked'
  simulated       INTEGER NOT NULL DEFAULT 0,   -- 1 = provider unconfigured, dev no-op
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX jobs_due  ON jobs(status, run_at);
CREATE INDEX jobs_lead ON jobs(lead_id);

-- Every email/SMS in or out — including no-op'd ones, so dev is testable offline.
CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  lead_id      TEXT REFERENCES leads(id),
  job_id       TEXT REFERENCES jobs(id),
  channel      TEXT NOT NULL CHECK (channel IN ('email','sms')),
  direction    TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound')),
  kind         TEXT NOT NULL CHECK (kind IN ('transactional','cold','internal')),
  template     TEXT NOT NULL DEFAULT '',
  to_addr      TEXT NOT NULL,
  subject      TEXT DEFAULT '',
  body         TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN (
                 'queued','sent','delivered','bounced','complained','failed',
                 'blocked','skipped_unconfigured','received')),
  block_reason TEXT,
  provider_id  TEXT,                   -- Resend id / Twilio SID (delivery webhooks key on this)
  sent_at      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX messages_lead ON messages(lead_id);
CREATE INDEX messages_provider ON messages(provider_id) WHERE provider_id IS NOT NULL;

-- Admin-togglable kill switches. ALL seeded 0 (off). Non-durable DB ⇒ treated as all-off in code.
CREATE TABLE channel_flags (
  channel    TEXT PRIMARY KEY CHECK (channel IN (
               'voice_outbound_ai','voice_outbound_bridge','sms',
               'email_transactional','email_cold','crawler','discovery')),
  enabled    INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,              -- 'dnc_synced_at','discovery_bbox','daily_cold_email_count:<date>', ...
  value TEXT NOT NULL
);

-- Append-only. Written from the four send/dial choke points. Never deleted.
CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  actor        TEXT NOT NULL,          -- 'system'|'cron'|'admin:<name>'|'vapi'|'customer'
  action       TEXT NOT NULL,          -- 'call_placed'|'call_blocked'|'email_sent'|'email_blocked'|'sms_sent'|
                                       -- 'sms_blocked'|'lead_approved'|'flag_toggled'|'dnc_added'|'lead_deleted'|...
  lead_id      TEXT,
  channel      TEXT,
  consent_tier TEXT,                   -- snapshot at action time
  payload_hash TEXT,                   -- sha256 of the exact rendered content sent
  meta         TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE admin_alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  at              TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('info','warn','critical')),
  kind            TEXT NOT NULL,       -- 'disclosure_missing'|'conduct_violation'|'queue_stalled'|'dnc_stale'|...
  message         TEXT NOT NULL,
  meta            TEXT NOT NULL DEFAULT '{}',
  acknowledged_at TEXT
);

-- Inbound webhook dedupe (Vapi/Twilio/Resend retries and out-of-order delivery).
CREATE TABLE webhook_events (
  provider    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_id)
);

-- ============================================================
-- 0002_scheduling.sql — appointments, availability, onboarding
-- ============================================================

CREATE TABLE appointments (
  id           TEXT PRIMARY KEY,
  lead_id      TEXT NOT NULL REFERENCES leads(id),
  kind         TEXT NOT NULL CHECK (kind IN ('sales_call','inspection','cleaning')),
  status       TEXT NOT NULL DEFAULT 'tentative' CHECK (status IN (
                 'tentative','confirmed','rescheduled','completed','cancelled','no_show')),
  starts_at    TEXT NOT NULL,
  ends_at      TEXT NOT NULL,
  timezone     TEXT NOT NULL,
  location     TEXT DEFAULT '',
  ics_sequence INTEGER NOT NULL DEFAULT 0,  -- bumped per reschedule; calendar clients update in place
  created_by   TEXT NOT NULL,               -- 'admin'|'vapi'|'customer'|'system'
  notes        TEXT DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX appts_time ON appointments(status, starts_at);

CREATE TABLE availability_rules (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  weekday   INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min INTEGER NOT NULL,          -- minutes from midnight, business timezone
  end_min   INTEGER NOT NULL,
  kind      TEXT NOT NULL DEFAULT 'any'
);

CREATE TABLE onboarding_forms (
  id           TEXT PRIMARY KEY,
  lead_id      TEXT NOT NULL UNIQUE REFERENCES leads(id),
  token_hash   TEXT NOT NULL UNIQUE,   -- sha256 of the raw 128-bit token; raw token never stored
  status       TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','opened','submitted','expired')),
  data         TEXT,                   -- JSON: hood count/locations, fuel types, roof access, hours,
                                       -- contacts, COI needs, NFPA 96 service frequency, preferred windows
  sent_at      TEXT NOT NULL,
  opened_at    TEXT,
  submitted_at TEXT
);

-- ============================================================
-- 0003_voice.sql — calls, national DNC
-- ============================================================

CREATE TABLE call_attempts (
  id                   TEXT PRIMARY KEY,
  lead_id              TEXT NOT NULL REFERENCES leads(id),
  direction            TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  mode                 TEXT NOT NULL CHECK (mode IN ('ai','human_bridge')),
  purpose              TEXT CHECK (purpose IN (
                         'inbound','quote_followup','appointment_confirmation','marketing','cold_intro')),
  job_id               TEXT REFERENCES jobs(id),
  vapi_call_id         TEXT UNIQUE,
  twilio_call_sid      TEXT UNIQUE,
  consent_tier_snapshot TEXT,          -- consent state frozen at dial time (TCPA evidence — D14/minimalist graft)
  line_type_snapshot   TEXT,
  dnc_exception_basis  TEXT,           -- 'inquiry_ebr'|'express_written'|NULL (D13)
  status               TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                         'queued','ringing','in_progress','completed','no_answer','voicemail','failed')),
  outcome              TEXT,           -- 'booked'|'callback_requested'|'not_interested'|'dnc_request'|
                                       -- 'quote_captured'|'opt_out'|'emergency_transfer'|NULL
  disclosure_played    INTEGER NOT NULL DEFAULT 0,
  disclosure_verified  INTEGER NOT NULL DEFAULT 0,  -- post-call transcript assertion result
  recording_url        TEXT,
  transcript           TEXT,           -- card/SSN-pattern REDACTED before persistence
  summary              TEXT,
  started_at TEXT, ended_at TEXT, duration_s INTEGER,
  cost_cents           INTEGER,
  created_at           TEXT NOT NULL
);
CREATE INDEX calls_lead ON call_attempts(lead_id, created_at);

CREATE TABLE dnc_national (
  phone_e164  TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL
);
-- freshness lives in settings.dnc_synced_at; >31 days ⇒ telemarketing dials without
-- a recorded exception are blocked campaign-wide (fail closed).

-- ============================================================
-- 0004_discovery.sql — crawler, provenance
-- ============================================================

CREATE TABLE crawl_domains (
  domain          TEXT PRIMARY KEY,
  robots_txt      TEXT,
  robots_fetched_at TEXT,              -- re-fetch after 24h; unparseable robots ⇒ treat as disallow-all
  crawl_delay_s   INTEGER NOT NULL DEFAULT 3,
  last_crawled_at TEXT,
  pages_fetched   INTEGER NOT NULL DEFAULT 0,
  denied          INTEGER NOT NULL DEFAULT 0,   -- 401/403/429/CAPTCHA-marker ⇒ permanent skip
  denied_reason   TEXT
);

-- Append-only compliance audit of every fetch.
CREATE TABLE crawl_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  url             TEXT NOT NULL,
  host            TEXT NOT NULL,
  fetched_at      TEXT NOT NULL,
  http_status     INTEGER,
  robots_decision TEXT NOT NULL,       -- 'allowed'|'disallowed'|'no_robots'|'robots_unparseable'
  outcome         TEXT NOT NULL        -- 'extracted'|'nothing_found'|'denied'|'error'|'skipped_no_harvest'
);

-- Per-address provenance: cold email REQUIRES a contact_points row with source_url (D9).
CREATE TABLE contact_points (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id      TEXT NOT NULL REFERENCES leads(id),
  kind         TEXT NOT NULL CHECK (kind IN ('email','phone')),
  value        TEXT NOT NULL,
  source_url   TEXT NOT NULL,          -- exact public page it was extracted from
  extracted_at TEXT NOT NULL,
  UNIQUE (lead_id, kind, value)
);
```

**Job-claim SQL (atomic, serverless-safe):**

```sql
UPDATE jobs
SET status='running', locked_at=:now, attempts=attempts+1, updated_at=:now
WHERE id IN (SELECT id FROM jobs
             WHERE status='pending' AND run_at <= :now
             ORDER BY run_at LIMIT 25)
RETURNING *;
-- Stale-lock reaper (start of every tick): running >10 min ⇒ back to pending.
-- Exhausted (attempts >= max_attempts) ⇒ status='dead' (surfaced in Jobs panel badge).
-- Retry backoff: run_at += attempts^2 * 5 minutes.
```

---

## 3. Module & File Map

```
src/
├── db/migrations/                      0001_core.sql … 0004_discovery.sql
├── lib/
│   ├── db.ts                           libSQL singleton; file:→dev / Turso→prod; VERCEL-without-Turso ⇒ null
│   │                                   (⇒ {configured:false} + channelFlags.allOff()); ONLY file importing @libsql/client;
│   │                                   documented escape hatches: `turso dev`, node:sqlite
│   ├── migrate.ts                      ~60-line runner: numbered .sql in a transaction, tracked in _migrations
│   ├── leads.ts                        CRUD, dedupe keys, tombstone check on insert, PostHog dual-write
│   ├── lead-machine.ts                 ALLOWED_TRANSITIONS map + transition(leadId,to,actor,meta) —
│   │                                   the only writer of leads.status; refuses illegal edges (422)
│   ├── jobs.ts                         enqueue()/claim()/complete()/fail(); reaper; idempotency; cancelByKeyPrefix()
│   ├── job-handlers/
│   │   ├── index.ts                    handler registry (plain map)
│   │   ├── send-email.ts               → email/send.ts choke point
│   │   ├── send-sms.ts                 → sms.ts choke point
│   │   ├── place-ai-call.ts            → compliance gauntlet → vapi.ts (NEVER reachable for tier 'none')
│   │   ├── lookup-line-type.ts         Twilio Lookup v2 → phone_line_type + checked_at (+90-day re-check)
│   │   ├── discover-osm.ts             Overpass sweep → leads(status 'discovered')
│   │   ├── crawl-site.ts               crawler orchestration (Apify fallback documented here)
│   │   ├── score-lead.ts               scoring + discovered/enriched → review_queue
│   │   ├── onboarding-nudge.ts         T+3d / T+7d re-invites
│   │   ├── daily-digest.ts             founder digest = dead-man heartbeat
│   │   ├── dnc-sync.ts                 FTC SAN change-lists → dnc_national + settings.dnc_synced_at
│   │   └── retention-sweep.ts          provider-side recording deletion + transcript purge (>90d);
│   │                                   EXEMPT: consent_events, revocations, dnc_*, audit_log, crawl_log
│   ├── compliance/
│   │   ├── tcpa.ts                     canPlaceAiCall(lead,purpose) / canPlaceBridgeCall(lead) — THE voice choke points
│   │   ├── consent.ts                  recordConsent(), currentTier(), revokeConsent(lead,channel,source,evidence)
│   │   │                               (revocation: tier→'none', dnc/suppression inserts, cancel pending jobs — one tx)
│   │   ├── dnc.ts                      internal+national scrub, exception recording, 31-day staleness check
│   │   ├── quiet-hours.ts              recipient-local window calc; NULL tz ⇒ blocked('tz_unknown')
│   │   ├── state-rules.ts              versioned per-state table (FL 8–20 & 3/24h, OK, WA, MD, CT); counsel-reviewed
│   │   ├── tz.ts                       static ZIP3-prefix→IANA map + area-code fallback (pure code, no dep)
│   │   └── audit.ts                    writeAudit() — called from all four choke points
│   ├── voice/
│   │   ├── vapi.ts                     fetch wrappers: create outbound call, fetch/delete artifacts
│   │   ├── bridge.ts                   Twilio click-to-dial: call founder → TwiML <Dial> lead (human speaks)
│   │   ├── scripts.ts                  FIXED code-reviewed constants: firstMessage (bot disclosure + recording
│   │   │                               disclosure + opt-out), voicemail script; version-stamped
│   │   └── redact.ts                   card/SSN digit-pattern redaction before any transcript persists
│   ├── email/
│   │   ├── send.ts                     THE email choke point: suppression check, cold-template partial assertion,
│   │   │                               daily cold cap, kind routing (transactional domain vs outreach subdomain),
│   │   │                               messages ledger incl. skipped_unconfigured
│   │   └── templates/                  template-literal HTML (site palette): quote-ack, appt-confirm(+ICS),
│   │                                   reminder-48h, onboarding invite/confirm, cold-intro (postal+unsub partials), digest
│   ├── sms.ts                          THE SMS choke point: kind 'transactional'|'marketing' gates, SMS_ENABLED,
│   │                                   quiet hours, revocation re-check, first-msg "Reply STOP to opt out."
│   ├── ics.ts                          ~60-line RFC 5545 VEVENT generator (METHOD:REQUEST, UID=appt id, SEQUENCE)
│   ├── appointments.ts                 slots vs availability_rules, overlap check, reminder fan-out,
│   │                                   HMAC token links (APPOINTMENT_LINK_SECRET, admin-auth.ts pattern)
│   ├── onboarding.ts                   token issue/verify (hash-stored), submit → transition + inspection draft
│   ├── discovery/
│   │   ├── overpass.ts                 bbox amenity query builder, polite fetch (1 concurrent, Retry-After)
│   │   ├── robots.ts                   ~50-line parser: UA groups, Allow/Disallow, Crawl-delay; unparseable ⇒ disallow-all
│   │   ├── crawler.ts                  ≤10 pages/site (contact/about prioritized), 1 req/3s/host, 8s timeout,
│   │   │                               honest UA, 401/403/429/CAPTCHA ⇒ permanent deny, crawl_log every fetch
│   │   ├── extract.ts                  mailto:/tel:/JSON-LD LocalBusiness extraction; no-harvest heuristic skip
│   │   ├── dedupe.ts                   E.164 / registrable-domain / name+geohash keys
│   │   ├── score.ts                    +hood-relevant amenity, +phone, +email, +inspection-violation flag
│   │   └── csv.ts                      hand-rolled parser + column mapping
│   └── phone.ts                        E.164 normalization (US)
├── app/
│   ├── api/quote/route.ts              MODIFIED (validation/rate-limit/PostHog kept — see §6.7)
│   ├── api/voice/route.ts              REPLACES 501 stub: Vapi webhook, both directions
│   ├── api/vapi/tools/route.ts         mid-call tools: check_availability, book_appointment, mark_dnc, request_callback
│   ├── api/cron/tick/route.ts          the worker (+ ?task= enqueue variants)
│   ├── api/webhooks/twilio-sms/route.ts    STOP/HELP → revocation pipeline (same tx)
│   ├── api/webhooks/twilio-voice/route.ts  TwiML for bridge legs + status callbacks
│   ├── api/webhooks/resend/route.ts        delivered/bounced/complained → messages + suppressions
│   ├── api/unsubscribe/route.ts        one-click HMAC-token unsubscribe
│   ├── api/appointments/[token]/route.ts + app/appointment/[token]/page.tsx   confirm/reschedule/cancel
│   ├── api/onboarding/[token]/route.ts   + app/onboard/[token]/page.tsx        public intake form
│   ├── api/admin/…                     see §4
│   ├── bot/page.tsx                    crawler transparency page (identity, behavior, opt-out contact)
│   └── privacy/page.tssx               privacy policy page (counsel-reviewed; linked from form/emails/agent script)
├── components/admin/                   Dashboard.tsx tab shell + panels (§8)
└── scripts/
    ├── backfill-posthog-leads.ts       one-time HogQL quote_submitted → leads import
    ├── verify-voice-config.ts          `npm run verify:voice-config` — diffs LIVE Vapi assistant config
    │                                   against repo canon (disclosure firstMessage, recording flag, tool set); CI gate
    └── tick.ts                         `npm run tick` — drain the queue locally on Windows
```

New runtime dependency: **`@libsql/client` only.** Every provider is plain `fetch()`.

---

## 4. API Routes

Auth legend — **admin**: existing cookie-HMAC `verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)` from `src/lib/admin-auth.ts`, unchanged. **cron**: `Authorization: Bearer CRON_SECRET` (dev: skipped when unset). **token**: HMAC-signed link token (admin-auth signing pattern, separate secret) or hash-stored random token. All inbound webhooks validate signatures with `timingSafeEqual` and dedupe via `webhook_events` before touching state.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/quote` | Existing behavior kept; + lead upsert (`inbound_form`, tier per checkbox), `consent_events` row w/ verbatim disclosure + IP + URL, enqueue quote-ack email + speed-to-lead `place_ai_call` (T+5m, purpose `quote_followup`) | public + existing in-memory rate limit |
| POST | `/api/voice` | Vapi webhook, both directions: end-of-call reports, status updates, transcripts → `call_attempts`, lead upsert/transition, disclosure assertion, revocation-phrase scan, PostHog `call_received`/`call_quote_captured` preserved | `x-vapi-secret` + event dedupe |
| POST | `/api/vapi/tools` | Mid-call tool calls: `check_availability`, `book_appointment` (creates `tentative` appt only), `mark_dnc`, `request_callback` | `x-vapi-secret` |
| GET | `/api/cron/tick` | Claim + execute due jobs (≤25, ~50s budget), reap stale locks, dead-letter | cron |
| GET | `/api/cron/tick?task=discovery\|digest\|dnc_sync\|retention` | Enqueue-only scheduled variants (see §5) | cron |
| POST | `/api/webhooks/twilio-sms` | Inbound SMS: STOP/QUIT/CANCEL/UNSUBSCRIBE/END + fuzzy revocation list → `revokeConsent` (dnc insert + job cancellation, one tx); HELP → static reply; log to `messages` | `X-Twilio-Signature` |
| POST | `/api/webhooks/twilio-voice` | TwiML for bridge second leg (`<Dial callerId=OUTBOUND_CALLER_ID>`), call status callbacks → `call_attempts` | `X-Twilio-Signature` |
| POST | `/api/webhooks/resend` | delivered/bounced/complained → `messages.status`; bounce/complaint → `email_suppressions` | svix signature (`RESEND_WEBHOOK_SECRET`) |
| GET | `/api/unsubscribe?token=` | One-click suppress + `revokeConsent(email)`; renders tiny branded confirmation | HMAC token |
| GET/POST | `/api/appointments/[token]` | Customer confirm / reschedule / cancel; reschedule bumps `ics_sequence`, cancels superseded reminder jobs by key prefix, re-fans-out | HMAC token (id+exp) |
| GET/POST | `/api/onboarding/[token]` | Prefill fetch / submit onboarding form → confirmation email, founder notify, transition, draft inspection appt | hash-stored 128-bit token + rate limit |
| GET | `/api/admin/calendar.ics?key=` | Read-only ICS feed of all appointments (founder calendar subscribe, zero OAuth) | static `ADMIN_ICS_FEED_KEY` |
| GET | `/api/admin/stats` | **Existing PostHog analytics route — untouched** | admin |
| GET | `/api/admin/pipeline` | Funnel counts per status, conversion rates, queue depth, upcoming appts | admin |
| GET | `/api/admin/leads` | Paginated list; filters: status/source/consent/approval; detail incl. full `lead_events` timeline + calls + messages | admin |
| PATCH | `/api/admin/leads/[id]` | Edit fields, notes (never status directly) | admin |
| POST | `/api/admin/leads/[id]/transition` | Manual status change through the state machine; illegal edge ⇒ 422 | admin |
| POST | `/api/admin/leads/approve` | Approve/reject for outreach; **bulk capped at 25/action**; writes `approved_by/at`, `audit_log`, PostHog `lead_approved` | admin |
| POST | `/api/admin/leads/[id]/call` | Enqueue AI call for **consented** leads only (runs `canPlaceAiCall`; 403 for tier `none` — no override exists) | admin |
| POST | `/api/admin/leads/[id]/bridge` | Founder click-to-dial (human bridge) — runs `canPlaceBridgeCall` (approval + landline + DNC-fresh + quiet hours) | admin |
| POST | `/api/admin/leads/import` | CSV upload → parse, tombstone+dedupe check, insert (`csv_import`, tier `none`, approval `pending`), enqueue `lookup_line_type` + `score_lead` | admin |
| DELETE | `/api/admin/leads/[id]` | `deleteLead`: null PII, tombstone hashes, dnc/suppression inserts, provider cascade (Vapi artifacts, Twilio recordings, PostHog `$delete_person`), audit row | admin |
| GET | `/api/admin/jobs` | Queue inspector: filter status/type; payload + last_error + attempts | admin |
| POST | `/api/admin/jobs/[id]/retry` | Reset failed/dead → pending (attempt history preserved) | admin |
| GET/POST | `/api/admin/appointments` | List (range) / create — create fans out confirmation(+ICS) and reminder jobs | admin |
| PATCH | `/api/admin/appointments/[id]` | Reschedule/cancel/complete/no-show; reminder jobs cancelled + re-fanned by dedupe-key prefix | admin |
| GET/PUT | `/api/admin/availability` | Read/write `availability_rules` (also consumed by the Vapi tool route) | admin |
| GET/POST | `/api/admin/dnc` | List / **add** internal DNC. **No DELETE handler exists** (D12) | admin |
| GET | `/api/admin/compliance` | Flags, alerts, DNC sync freshness, suppression counts, provider-health (configured vs no-op) card data | admin |
| POST | `/api/admin/flags` | Toggle a `channel_flags` row; audit row per toggle | admin |
| POST | `/api/admin/alerts/[id]/ack` | Acknowledge an admin alert | admin |
| POST | `/api/admin/discovery/run` | Enqueue Overpass sweep / re-crawl stale sites manually | admin |

Public pages (no API auth; token-gated where applicable): `/appointment/[token]`, `/onboard/[token]`, `/bot`, `/privacy`.

---

## 5. Cron Design

No long-lived processes. All schedules are delivery-latency knobs; correctness lives in `jobs.run_at` + idempotency keys, so over-firing, double-firing, and missed ticks are all safe.

| Endpoint | Schedule | What it does |
|---|---|---|
| `/api/cron/tick` | `*/5 * * * *` Vercel Pro (or every-1-min external ping) | Reap stale locks (>10 min running → pending); claim ≤25 due jobs atomically; execute handlers under ~50s wall budget; backoff-retry (attempts²×5min); dead-letter at `max_attempts` |
| `/api/cron/tick?task=digest` | `0 13 * * *` (~8am business local) | Enqueue `daily_digest`: today's appointments, new leads, pending approvals, **dead-job and stalled-queue counts** — the dead-man heartbeat; if the digest itself stops arriving, the pipeline is down |
| `/api/cron/tick?task=discovery` | `0 3 * * 1` | Enqueue Overpass sweep + `crawl_site` jobs for new/stale leads (per-domain politeness enforced inside job scheduling, not by the cron) |
| `/api/cron/tick?task=dnc_sync` | `0 4 * * 2` | Enqueue `dnc_sync` (FTC SAN change lists → `dnc_national`, stamp `settings.dnc_synced_at`); on failure or staleness >31d raise `dnc_stale` alert — telemarketing dials without recorded exceptions auto-block |
| `/api/cron/tick?task=retention` | `0 5 * * 0` | Enqueue `retention_sweep`: delete recordings at Vapi/Twilio + local transcripts older than `RECORDING_RETENTION_DAYS` (90); prune done/failed jobs >30d; **never** touches consent/revocation/DNC/audit/crawl_log |

**Hosting reality:** Vercel Hobby limits crons to daily — unacceptable for reminders. Options, decided at Phase 1 deploy: (a) Vercel Pro ($20/mo, recommended once real appointments flow), or (b) free cron-job.org / GitHub Actions schedule pinging the same Bearer-authed URL — the endpoint is pinger-agnostic, honoring the README's "any Node host works." The daily digest doubles as the staleness detector either way. Local dev: `npm run tick` drains the queue by hand.

**Reminder fan-out (created with the appointment, executed by tick):** confirmation email+ICS immediately; email T-48h; SMS T-24h; AI confirmation call T-4h only if still unconfirmed **and** tier permits (`appointment_confirmation`). Idempotency keys embed `ics_sequence` (`sms:appt_24h:<apptId>:<seq>`) so a reschedule cancels stale jobs by prefix and re-enqueues cleanly. Voice reminders beyond the first confirmation call queue for human review — never auto-place repeat AI calls at someone who hasn't engaged.

---

## 6. Provider Integration Contracts

All calls are raw `fetch()`. Every helper: (1) checks its env vars — missing ⇒ record the action with `simulated=1` / `messages.status='skipped_unconfigured'` and `console.log('[dev no-op] …')`, matching `posthog-server.ts`'s pattern; (2) **but compliance gates still run first** — a blocked send is `blocked`, never `skipped`. Payload field names below are the contract shape; implementers must verify exact current field names against live provider docs at build time (post-cutoff drift) — `verify-voice-config.ts` institutionalizes this for Vapi.

### 6.1 Vapi (voice AI, both directions)

- **Outbound dial** (from `place-ai-call` handler, post-gauntlet): `POST https://api.vapi.ai/call`, `Authorization: Bearer VAPI_API_KEY`, body `{ assistantId: VAPI_ASSISTANT_OUTBOUND_ID, phoneNumberId: VAPI_PHONE_NUMBER_ID, customer: { number: lead.phone_e164 }, metadata: { leadId, purpose, jobId } }`.
- **Webhook → `POST /api/voice`**: header `x-vapi-secret` == `VAPI_WEBHOOK_SECRET` (timing-safe). Envelope `{ message: { type, call: { id, direction, … }, artifact/transcript, endedReason, … } }`; handled types: `status-update`, `end-of-call-report`, `tool-calls`. Dedupe on `(provider='vapi', event_id=call.id + type)`. End-of-call: upsert `call_attempts` by `vapi_call_id`; redact transcript; assert first agent turn contains the disclosure constant (fail ⇒ `disclosure_verified=0`, `admin_alerts` critical, auto-toggle `voice_outbound_ai` off); scan for revocation phrases ⇒ `revokeConsent` in-request; conduct scans (price-commitment, human-denial patterns) ⇒ alert, auto-pause after 2 flags/24h; transition lead by outcome; mirror PostHog events per the existing plan.
- **Tool calls → `POST /api/vapi/tools`** (same secret): `check_availability` (reads `availability_rules` + overlap), `book_appointment` (creates **tentative** appointment only — a founder confirms; the agent never owns state and has no price/contract tool by design), `mark_dnc`, `request_callback`.
- **Assistant config is repo canon** (`src/lib/voice/scripts.ts`): fixed `firstMessage` = bot disclosure + business name + callback number + "you can say stop at any time" + recording disclosure (when recording on). CI runs `verify:voice-config` to diff live config against canon.
- Env: `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, `VAPI_PHONE_NUMBER_ID`, `VAPI_ASSISTANT_INBOUND_ID`, `VAPI_ASSISTANT_OUTBOUND_ID`.

### 6.2 Twilio (number, SMS, Lookup, bridge)

- **SMS send**: `POST https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json`, Basic auth, form-encoded `To`, `Body`, `MessagingServiceSid` (preferred) or `From=TWILIO_FROM_NUMBER`. First message to any number appends "Reply STOP to opt out."
- **Lookup v2**: `GET https://lookups.twilio.com/v2/PhoneNumbers/{E164}?Fields=line_type_intelligence` → store `line_type_intelligence.type`; unset creds ⇒ `'unknown'` ⇒ **AI calls blocked** (fail closed).
- **Inbound SMS webhook**: form-encoded `From`, `Body`, `MessageSid`; validate `X-Twilio-Signature` (HMAC-SHA1 over full URL + sorted params, key = auth token, timing-safe).
- **Click-to-dial bridge**: `POST /Calls.json` `To=<founder phone>`, `From=OUTBOUND_CALLER_ID`, `Url=/api/webhooks/twilio-voice?leadId=…&sig=…`; answered leg receives TwiML `<Dial callerId="OUTBOUND_CALLER_ID"><Number>lead</Number></Dial>`. Human speaks; no AI or prerecorded audio on the line; recording off.
- One-time console tasks (runbook): buy number in Twilio, import into Vapi, SHAKEN/STIR + CNAM ("VentWash") via Trust Hub, A2P 10DLC brand+campaign before `SMS_ENABLED=1`.
- Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_FROM_NUMBER`, `OUTBOUND_CALLER_ID`, `SMS_ENABLED`.

### 6.3 Resend (email)

- **Send**: `POST https://api.resend.com/emails`, Bearer `RESEND_API_KEY`, `{ from, to, reply_to, subject, html, attachments:[{filename:'appointment.ics', content:<base64>}] }`. Transactional `from=EMAIL_FROM`; cold `from=COLD_EMAIL_FROM` (outreach subdomain, own SPF/DKIM/DMARC).
- **Webhook**: svix headers (`svix-id`, `svix-timestamp`, `svix-signature`, HMAC-SHA256 with `RESEND_WEBHOOK_SECRET`); events `email.delivered|bounced|complained` matched to `messages.provider_id`; bounce/complaint ⇒ `email_suppressions` insert.
- Env: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `COLD_EMAIL_FROM`, `BUSINESS_POSTAL_ADDRESS`, `MAX_COLD_EMAILS_PER_DAY` (default 50).

### 6.4 Overpass / OSM

`POST OVERPASS_API_URL` (default `https://overpass-api.de/api/interpreter`), body `data=[out:json][timeout:25]; node[amenity~"restaurant|fast_food|cafe|bar"](DISCOVERY_BBOX); out tags center;` (+ways). Max 1 concurrent query, honor `Retry-After`, exponential backoff on 429/504, per-run cap. UA: `CRAWLER_USER_AGENT`. ODbL: "© OpenStreetMap contributors" rendered in admin wherever OSM-sourced leads appear. Env: `OVERPASS_API_URL`, `DISCOVERY_BBOX`, `CRAWLER_USER_AGENT` (default `VentWashLeadBot/1.0 (+https://<site>/bot; contact iamfarzaad@gmail.com)`).

### 6.5 FTC National DNC

Weekly `dnc_sync` job downloads change lists for operating area codes using `DNC_SAN`, upserts `dnc_national`, stamps `settings.dnc_synced_at`. Missing SAN / stale >31d ⇒ marketing + cold dials blocked campaign-wide. Env: `DNC_SAN`.

### 6.6 Core / cross-cutting env

`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `CRON_SECRET`, `APPOINTMENT_LINK_SECRET`, `ADMIN_ICS_FEED_KEY`, `BUSINESS_TIMEZONE` (display/founder-side only — recipient rules always use lead tz), `RECORDING_ENABLED` (unset = off), `RECORDING_RETENTION_DAYS` (90). Existing untouched: `ADMIN_PASSWORD`/`SESSION_SECRET`, PostHog vars. **Zero-env dev:** `npm run dev` gives a fully working local pipeline on `file:./data/ventwash.db` (gitignored, auto-created, auto-migrated); every provider no-ops with ledger rows; all channel flags read as off.

### 6.7 `/api/quote` modification contract

Existing validation, rate limit, `captureServerEvent('quote_submitted', …)`, and console logging are kept byte-for-byte. Added after capture: E.164-normalize phone → upsert lead (`discovery_source='inbound_form'`, status `engaged`, tier `express`; checkbox ticked ⇒ `express_written`) → `consent_events` row (verbatim disclosure text as rendered, IP, form URL, raw payload) → enqueue `send_email` (quote-ack), `lookup_line_type`, and `place_ai_call` (`run_at=now+5min`, purpose `quote_followup`, idempotency `call:speed_to_lead:<leadId>`). The QuoteModal gains the optional consent checkbox (unchecked by default) with counsel-approved E-SIGN language naming VentWash and automated/AI calls & texts.

---

## 7. Lead Lifecycle State Machine

Single writer: `transition()` in `src/lib/lead-machine.ts` — validates against this map, writes `leads.status` + append-only `lead_events` row in one transaction, mirrors a PostHog event. Illegal edges throw (API surfaces 422).

**States:** `discovered → enriched → review_queue → approved_outreach → contacting → engaged → appointment_scheduled → won_pending_onboarding → onboarded → inspection_scheduled → customer`, plus terminals `lost` and `do_not_contact`. Inbound shortcut: web form / inbound call enters directly at `engaged`.

| From → To | Driven by |
|---|---|
| (create) → `discovered` | `discover_osm` / CSV import / manual entry (tombstone-checked, deduped; tier `none`, approval `pending`; enqueues `lookup_line_type` + `crawl_site` + `score_lead`) |
| (create) → `engaged` | `/api/quote` (tier `express`/`express_written`) or Vapi inbound webhook (tier `express`, source `inbound_call`) |
| `discovered` → `enriched` | `crawl_site` job found contact points (provenanced `contact_points` rows) |
| `discovered`/`enriched` → `review_queue` | `score_lead` job (score ≥ threshold; queue ordered by score) |
| `review_queue` → `approved_outreach` | **Founder approval click** (≤25/bulk; `approved_by/at`, audit row, PostHog `lead_approved`) |
| `review_queue` → `lost` | Founder reject |
| `approved_outreach` → `contacting` | Outreach worker sends the approved cold email (`send_email`, kind `cold`) or founder opens a bridge-dial task |
| `contacting` → `engaged` | Reply received (email/SMS webhook), inbound call, form submit, or founder logs a live-conversation outcome |
| `contacting` → `lost` | System: attempts/nudges exhausted (14-day stale sweep) or founder |
| `engaged` → `appointment_scheduled` | Booking: Vapi `book_appointment` tool (tentative), admin create, or customer token page |
| `appointment_scheduled` → `engaged` | Appointment cancelled / no-show (system re-opens follow-up) |
| `appointment_scheduled` → `won_pending_onboarding` | Founder marks won (typically after sales call/inspection visit) — auto-issues onboarding token + invite email + T+3d/T+7d nudge jobs |
| `won_pending_onboarding` → `onboarded` | Onboarding form submitted (system: confirmation email + founder notification) |
| `onboarded` → `inspection_scheduled` | System drafts inspection appointment from preferred windows; founder one-click confirms (fans out reminders) |
| `inspection_scheduled` → `customer` | Founder marks inspection appointment completed |
| any → `lost` | Founder (with reason meta) |
| any → `do_not_contact` | **Revocation pipeline only** (STOP, in-call opt-out, unsubscribe-all, admin DNC) — terminal; same transaction cancels all pending jobs for the lead |

Consent tier is orthogonal to status and only moves via `consent_events` (up) or `revocations` (to `none`). Approval is orthogonal and applies only to tier-`none` leads (`not_required` for inbound sources).

---

## 8. Admin UI Additions

`Dashboard.tsx` becomes a thin tab shell preserving its exact visual grammar — the existing constants `INK #1a2129`, `ACCENT #3E6FA6`, `MONO 'IBM Plex Mono'`, `HEAD 'Archivo'`, `CARD_BORDER 1px solid rgba(26,33,41,.1)`, 8px-radius white cards, 11px/0.14em uppercase kickers, recharts idioms. Auth surface unchanged: every new `/api/admin/*` route opens with the identical `verifySessionToken` guard. Unconfigured DB renders the same `{configured:false}` empty-state pattern the Analytics tab already uses.

- **Persistent kill-switch strip** (above the tabs, every admin page): one toggle per `channel_flags` row with colored state dots; toggling posts to `/api/admin/flags` and writes an audit row. Unacknowledged `critical` alerts render as a red banner here.
- **[Analytics]** — the current PostHog dashboard, byte-for-byte untouched.
- **[Pipeline]** — recharts funnel across lifecycle statuses; status-column board; per-lead slide-over drawer: monospace `lead_events` audit timeline (timestamp/actor/transition/meta), consent badge (green `EXPRESS WRITTEN` / blue `EXPRESS` / amber `COLD — AI LOCKED`), line-type chip, score, contact points with source URLs (the "where did you get my number?" answer), buttons: Queue AI call (consented only; hidden for tier `none`), Bridge dial (cold: disabled unless approved + landline/fixed-VoIP + DNC fresh, with the compliance-checklist confirm dialog), Send onboarding invite, Add to DNC, Delete lead (privacy). OSM attribution footer whenever OSM-sourced leads are visible.
- **[Review]** — the human-in-the-loop cold-outreach gate: queue ordered by score showing discovery source, provenance, the **exact rendered cold-email draft**, and compliance-check results; approve/reject; bulk approve hard-capped at 25.
- **[Appointments]** — 7-day agenda grouped by day; per-appointment reminder-job status pills (scheduled/sent/delivered/failed — fed by Resend webhooks); create/edit modal with overlap warning; availability-rules weekly editor; "Subscribe (ICS)" link to the feed.
- **[Jobs]** — the debuggability centerpiece: status filter chips, payload/error expanders, Retry button, `simulated` badge, **dead-job count badge on the tab itself** so failures are impossible to miss.
- **[Compliance]** — DNC manager (add + list only; no remove control exists), national-DNC freshness card (green ≤31d / red stale ⇒ "cold dialing blocked"), revocations log, suppression list, call log with consent-tier snapshots, `disclosure_verified` flags, recording links + transcript expanders, alert center, provider-health card (configured vs no-op per provider), CSV import with column-mapping preview + dedupe/tombstone report, discovery bbox display.

---

## 9. Phased Delivery Plan

Each phase is independently shippable by the 2-person team; compliance-relevant launch gates are hard preconditions, not advisories.

**Phase 0 — Spine (week 1).** `@libsql/client`, `db.ts` + migrations 0001, jobs table + `/api/cron/tick` + `CRON_SECRET`, lead state machine + `lead_events`, `channel_flags` seeded all-off, `/api/quote` dual-write with consent checkbox + `consent_events`, `lookup_line_type` handler, read-only Leads/Jobs panels + kill-switch strip, heartbeat job, PostHog backfill script. *Nothing user-visible changes; every web lead now has a durable row, a consent trail, and an audit timeline, and the queue is provable in prod.*

**Phase 1 — Scheduling & reminders (weeks 2–3).** Migration 0002; `ics.ts`, `email/send.ts` + templates, `sms.ts`; appointments + availability + token confirm/reschedule pages; reminder fan-out with send-time re-validation; `/api/unsubscribe`; Resend delivery webhook; Twilio inbound-SMS webhook (STOP pipeline); `calendar.ics` feed; daily digest; Appointments panel; **`/privacy` page ships here** (before any outbound message leaves the system). *Gates:* SPF/DKIM/DMARC verified; cron frequency decision (Pro vs pinger); 10DLC registered before `SMS_ENABLED=1`; flip `email_transactional` (and optionally `sms`) on.

**Phase 2 — Inbound voice (weeks 3–5).** Migration 0003; execute the existing `docs/voice-automation-plan.md` Phase 1 (Vapi after-hours pilot) with upgrades: `/api/voice` writes `call_attempts` + leads (tier `express`, `inbound_call`) with `webhook_events` dedupe, not just PostHog; `/api/vapi/tools` lets callers book real (tentative) slots; disclosure + recording constants in `scripts.ts`; `verify:voice-config` in CI; retention sweep job. *Lowest-risk voice phase ships first, per the guardrails' explicit recommendation.*

**Phase 3 — Onboarding loop (weeks 5–6).** `/onboard/[token]` public form (site-styled; NFPA 96 fields), hash-stored tokens, invite/confirmation emails, T+3d/T+7d nudges, auto-drafted inspection appointment feeding Phase 1 machinery, onboarding tracker in Pipeline drawer. *Closes the owner's fourth automation: won → active is hands-off.*

**Phase 4 — Lead gen + cold email (weeks 6–8).** Migration 0004. Order inside the phase: CSV import first (immediate value, zero scraping risk) → Overpass discovery → robots-respecting crawler + `/bot` page + `crawl_log` → scoring → Review queue + approval flow → cold email (provenance-gated, capped, subdomain, `email_cold` flag). *Gates:* outreach subdomain DNS auth; no-harvest heuristic tested; founders briefed that approval = a logged legal decision.

**Phase 5 — Outbound voice (weeks 8–10).** Outbound Vapi assistant + `place_ai_call` behind the full gauntlet. Rollout: (a) speed-to-lead quote callbacks (express, evidence stored — flip `voice_outbound_ai` on for this purpose first); (b) T-4h appointment-confirmation calls; (c) founder click-to-dial bridge for approved cold landlines (`voice_outbound_bridge`), starting with a 20-lead manually-approved pilot. **AI never dials tier `none` — this phase contains no cold-AI path to enable.** *Gates (launch blockers):* counsel review of consent checkbox language, disclosure scripts, `state-rules.ts`, and privacy policy; `DNC_SAN` subscription + first successful `dnc_sync` before any bridge dialing; `verify:voice-config` green.

---

## 10. Compliance Mechanisms

### 10.1 The four choke points (the only code that touches the outside world)

**`canPlaceAiCall(lead, purpose)`** — every AI dial (speed-to-lead, confirmation calls, admin "Queue AI call", any future campaign) passes or throws. Sequential, all fail-closed, each refusal writes `jobs.status='blocked'` + reason code + `audit_log` + PostHog `call_blocked_compliance`:
durable DB → `voice_outbound_ai` flag on → not revoked (voice/all) → not in `dnc_internal` → consent matrix (below) → line type known and consistent with tier (unset Twilio ⇒ `unknown` ⇒ blocked) → national-DNC scrub with recorded exception or fresh data (§D13) → recipient-local quiet hours (`timezone IS NULL` ⇒ `tz_unknown` block; strictest of federal 8–21 and `state-rules.ts`) → per-state frequency caps (default 3 attempts/24h, 1 voicemail/campaign) → disclosure script version pinned. On pass: `call_attempts` row created **before** dialing with `consent_tier_snapshot`, `line_type_snapshot`, `dnc_exception_basis` frozen.

| tier \ purpose | `quote_followup` | `appointment_confirmation` | `marketing` |
|---|---|---|---|
| `none` | ✗ (no override exists) | ✗ | ✗ |
| `express` | ✓ within 90d of inquiry (`inquiry_ebr`) | ✓ for a booked appointment | ✗ |
| `express_written` | ✓ | ✓ | ✓ (requires fresh `dnc_national` ≤31d) |

**`canPlaceBridgeCall(lead)`** — the only path to a tier-`none` phone: `voice_outbound_bridge` flag on → `approval='approved'` (named founder, audited) → `phone_line_type IN ('landline','fixedVoip')` (wireless/unknown ⇒ button disabled in UI *and* blocked in API) → not revoked/DNC-internal → `dnc_national` fresh ≤31d and number clear (no SAN ⇒ no cold dialing through the system, period) → quiet hours + state caps. The bridge carries only human voice; `OUTBOUND_CALLER_ID` is hard-coded in the helper with no per-call override (Truth in Caller ID); recording off.

**`sendEmail(msg)`** — suppression check inside the send; `kind='cold'` additionally requires: `email_cold` flag, lead `approval='approved'`, a `contact_points` row with `source_url` for the exact address (unprovenanced addresses cannot enter a cold send), under `MAX_COLD_EMAILS_PER_DAY` (atomic counter in `settings`), sent from `COLD_EMAIL_FROM` subdomain, and template containing the postal-address + one-click-unsubscribe partials — asserted at build time (template lint) *and* runtime (refuses to render without them). Every send/refusal is a `messages` row with `payload_hash` in `audit_log`.

**`sendSms(msg, kind)`** — `SMS_ENABLED` + 10DLC registered + `sms` flag → `transactional` requires booked/customer status and a phone volunteered via form/call (consent_events); `marketing` requires `express_written` with `channel_scope IN ('sms','all')` → revocation re-check at send time → recipient-local quiet hours → first-message STOP notice. Scraped numbers are structurally unreachable (no consent event can exist for them).

### 10.2 Guardrail → mechanism map

| Guardrail | Concrete mechanism (all specified above) |
|---|---|
| Consent tiers as schema constraint | `leads.consent_tier` CHECK + append-only `consent_events` with verbatim `disclosure_text`; `/api/quote` writes the record; purpose matrix in `tcpa.ts`; no override flag exists |
| Wireless/line-type gate | `lookup_line_type` job at creation/import, 90-day re-check, `unknown` fails closed; UI disables cold-call affordances for wireless; bridge restricted to landline/fixed-VoIP |
| Calling hours | Recipient-local via `tz.ts` (ZIP3 → area-code → NULL=blocked); `state-rules.ts` versioned, counsel-reviewed; frequency caps on `call_attempt_count`/`last_call_at`/`voicemail_count` |
| National + internal DNC | `dnc_sync` weekly job, `settings.dnc_synced_at`, 31-day campaign-wide fail-closed; `dnc_internal` write-once (no delete endpoint); in-call "stop calling" → insert within the same webhook request |
| Revocation (FCC 2025) | `revokeConsent()` called from SMS STOP webhook, unsubscribe route, voice webhook intent+phrase scan, admin button; one transaction: tier→`none`, DNC/suppression inserts, cancel all pending jobs; channel `all` unless clarified |
| Bot disclosure + in-call opt-out | Fixed `firstMessage` constant in `scripts.ts` (git-reviewed); `mark_dnc` tool mandatory; post-call transcript assertion ⇒ alert + auto-pause `voice_outbound_ai` on failure; separate fixed voicemail script |
| Caller ID integrity | Single `OUTBOUND_CALLER_ID`, hard-coded in dial helpers, no override param; SHAKEN/STIR + CNAM registration; the number reaches the inbound agent (which can process DNC) |
| Recording consent | All-party posture; disclosure inside `firstMessage`; `RECORDING_ENABLED` unset ⇒ off; `verify:voice-config` CI diff of live assistant config; warm transfers set recording off |
| Recording retention | `retention_sweep` deletes at provider + local after 90d; deletion audit rows; consent/DNC/revocations/audit/crawl_log exempt |
| CAN-SPAM cold email | Postal + unsubscribe partials enforced twice; suppression check in-send; instant one-click unsubscribe; `source_url` provenance requirement; no-harvest heuristic in `extract.ts`; ≤50/day; outreach subdomain |
| Permitted discovery sources | `discovery_source` CHECK has no google/yelp; no Google/Yelp client in the repo (dependency review); Overpass politeness + ODbL attribution in admin |
| Crawling conduct | robots.txt honored (unparseable ⇒ disallow-all), 1 req/3s/host, ≤10 pages/site, honest UA → `/bot` page, 401/403/429/CAPTCHA ⇒ permanent `denied`, no login/paywall/CAPTCHA paths exist, every fetch in `crawl_log` |
| SMS consent classes | `sendSms(kind)` gates; `SMS_ENABLED` + 10DLC launch gate; STOP/HELP webhook; quiet hours |
| Send-time re-validation | Full gate re-runs inside the same transaction that claims each job; failures → `blocked` with reason, never retried blindly; `dedupe_key` idempotency |
| Human-in-the-loop cold gate | `approval` columns + Review queue showing the exact draft; bulk cap 25; SQL filters on `approval='approved'`; audit + PostHog on approve |
| Kill switch + audit | `channel_flags` strip (default off, either founder, no redeploy); `audit_log` written from all four choke points; append-only, retention-exempt |
| Privacy & DSRs | `/privacy` page (Phase 1); `deleteLead` with tombstones, provider cascade (Vapi/Twilio/PostHog), suppression+DNC preservation; per-lead provenance display |
| Datastore/PII hygiene | Turso encrypted-at-rest + PITR; `VERCEL`-without-Turso ⇒ null DB ⇒ all channels off (`if (!db.durable) channelFlags.allOff()`); all webhooks signature-validated timing-safe; secrets only in env |
| AI conduct limits | No price/contract tools in the Vapi schema; bookings are tentative-only; transcript scans (price, human-denial, card digits pre-redacted); 2 flags/24h ⇒ auto-pause; one-voicemail cap |

### 10.3 Hard-block enforcement points

Every hard block from the guardrail document terminates at code that has **no bypass parameter**: tier-`none` AI dial → `tcpa.ts` throws, API 403, no admin flag exists; wireless/unknown AI dial without consent → line-type gate; out-of-hours / unknown-tz dial → `quiet-hours.ts`; DNC'd or stale-registry dial → `dnc.ts`; record-before-disclosure → config canon + CI verify + default-off; human-impersonation/pricing/card capture → prompt canon + post-call assertions + auto-pause + pre-persist redaction; spoofed caller ID → single hard-coded env; Google/Yelp ingestion → schema CHECK + absent client; robots/CAPTCHA/login crawling → crawler has no such code path + permanent deny ledger; unsubscribe-less or unprovenanced cold email → template assertions + provenance join; unapproved first-touch → `approval` SQL filter; marketing SMS without written consent / pre-10DLC → `sendSms` gates; gate-incomplete sends → **everything fails closed**; editing consent/revocation/DNC/audit rows → no UPDATE/DELETE code paths exist and retention exempts them.

### 10.4 Residual risks & operating notes

- **TCPA remains the existential risk** ($500–$1,500/call statutory; active plaintiffs' bar targeting exactly this pattern). The architecture makes the default-safe path (AI calls only to form/inbound leads with recorded consent) the *only* automated path; counsel review of the checkbox language, scripts, state rules, and privacy policy is a Phase 5 launch blocker, not a recommendation.
- Vercel Hobby's daily-cron limit vs. reminder latency: decided at Phase 1 (Pro $20/mo or free pinger); the digest heartbeat surfaces silent staleness either way.
- Turso vendor risk: plain-SQLite portability + nightly dump (add to retention cron on Pro); single primary region to avoid replica-lag double-sends.
- `@libsql/client` win32 prebuilt lag on future Node majors: `turso dev` / `node:sqlite` fallbacks confined behind `db.ts`.
- Overpass data quality is uneven — CSV + health-dept open data are expected to carry real weight; regex extraction misses JS-rendered sites (accepted; Apify actor is the documented fallback, config-swapped inside `crawl_site`).
- Dual-truth drift (PostHog vs DB) is by design: Pipeline tab is authoritative; the Phase 0 backfill closes the historical seam once.
- Vapi platform dependency for both directions: portable webhook contract + documented DIY path (>2,000 min/mo) is the hedge; monitor `cost_cents` in the Compliance panel.