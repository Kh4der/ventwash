/**
 * Database migrations, embedded as TypeScript constants.
 *
 * The spec (docs/automation-platform-spec.md §2) describes these as numbered
 * .sql files; they are embedded here instead so the Next.js server bundle
 * never depends on reading loose files from disk at runtime. Each migration
 * is an ordered list of single statements (libSQL batch executes them inside
 * one transaction per migration).
 *
 * Rules:
 *  - NEVER edit an applied migration; append a new one.
 *  - Append-only tables (consent_events, revocations, dnc_internal, audit_log,
 *    lead_events, crawl_log, tombstones) must never gain UPDATE/DELETE code
 *    paths in the app, and the retention sweep must never touch them.
 */

export interface Migration {
  id: number;
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "core",
    statements: [
      `CREATE TABLE IF NOT EXISTS leads (
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
                              'inbound_form','inbound_call','manual')),
        provenance_note     TEXT,
        business_name       TEXT NOT NULL,
        contact_name        TEXT DEFAULT '',
        phone_e164          TEXT,
        phone_line_type     TEXT,
        line_type_checked_at TEXT,
        email               TEXT,
        website             TEXT,
        address TEXT, city TEXT, region TEXT, postal TEXT,
        lat REAL, lng REAL,
        timezone            TEXT,
        cuisine             TEXT DEFAULT '',
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
        dedupe_key          TEXT NOT NULL,
        deleted_at          TEXT
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS leads_dedupe ON leads(dedupe_key) WHERE deleted_at IS NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS leads_osm ON leads(osm_id) WHERE osm_id IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS leads_status ON leads(status)`,
      `CREATE INDEX IF NOT EXISTS leads_phone ON leads(phone_e164) WHERE phone_e164 IS NOT NULL`,

      `CREATE TABLE IF NOT EXISTS lead_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id     TEXT NOT NULL REFERENCES leads(id),
        at          TEXT NOT NULL,
        type        TEXT NOT NULL,
        from_status TEXT,
        to_status   TEXT,
        actor       TEXT NOT NULL,
        meta        TEXT NOT NULL DEFAULT '{}'
      )`,
      `CREATE INDEX IF NOT EXISTS lead_events_lead ON lead_events(lead_id, at)`,

      `CREATE TABLE IF NOT EXISTS consent_events (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id         TEXT NOT NULL REFERENCES leads(id),
        tier            TEXT NOT NULL CHECK (tier IN ('express','express_written')),
        channel_scope   TEXT NOT NULL DEFAULT 'all' CHECK (channel_scope IN ('all','voice','sms','email')),
        captured_at     TEXT NOT NULL,
        source          TEXT NOT NULL,
        ip              TEXT,
        form_url        TEXT,
        disclosure_text TEXT NOT NULL,
        raw_payload     TEXT NOT NULL DEFAULT '{}'
      )`,

      `CREATE TABLE IF NOT EXISTS revocations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id    TEXT REFERENCES leads(id),
        phone_e164 TEXT,
        email      TEXT,
        channel    TEXT NOT NULL DEFAULT 'all' CHECK (channel IN ('all','voice','sms','email')),
        source     TEXT NOT NULL,
        evidence   TEXT NOT NULL,
        revoked_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS dnc_internal (
        phone_e164 TEXT PRIMARY KEY,
        reason     TEXT NOT NULL,
        added_by   TEXT NOT NULL,
        added_at   TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS email_suppressions (
        email    TEXT PRIMARY KEY,
        reason   TEXT NOT NULL,
        source   TEXT NOT NULL,
        added_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS tombstones (
        hash       TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS jobs (
        id              TEXT PRIMARY KEY,
        type            TEXT NOT NULL,
        payload         TEXT NOT NULL DEFAULT '{}',
        lead_id         TEXT,
        status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending','running','done','failed','dead','cancelled','blocked')),
        run_at          TEXT NOT NULL,
        attempts        INTEGER NOT NULL DEFAULT 0,
        max_attempts    INTEGER NOT NULL DEFAULT 5,
        idempotency_key TEXT UNIQUE,
        locked_at       TEXT,
        last_error      TEXT,
        block_reason    TEXT,
        simulated       INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, run_at)`,
      `CREATE INDEX IF NOT EXISTS jobs_lead ON jobs(lead_id)`,

      `CREATE TABLE IF NOT EXISTS messages (
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
        provider_id  TEXT,
        sent_at      TEXT,
        created_at   TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS messages_lead ON messages(lead_id)`,
      `CREATE INDEX IF NOT EXISTS messages_provider ON messages(provider_id) WHERE provider_id IS NOT NULL`,

      `CREATE TABLE IF NOT EXISTS channel_flags (
        channel    TEXT PRIMARY KEY CHECK (channel IN (
                     'voice_outbound_ai','voice_outbound_bridge','sms',
                     'email_transactional','email_cold','crawler','discovery')),
        enabled    INTEGER NOT NULL DEFAULT 0,
        updated_by TEXT,
        updated_at TEXT
      )`,
      `INSERT OR IGNORE INTO channel_flags (channel, enabled) VALUES
        ('voice_outbound_ai',0),('voice_outbound_bridge',0),('sms',0),
        ('email_transactional',0),('email_cold',0),('crawler',0),('discovery',0)`,

      `CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS audit_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        at           TEXT NOT NULL,
        actor        TEXT NOT NULL,
        action       TEXT NOT NULL,
        lead_id      TEXT,
        channel      TEXT,
        consent_tier TEXT,
        payload_hash TEXT,
        meta         TEXT NOT NULL DEFAULT '{}'
      )`,

      `CREATE TABLE IF NOT EXISTS admin_alerts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        at              TEXT NOT NULL,
        severity        TEXT NOT NULL CHECK (severity IN ('info','warn','critical')),
        kind            TEXT NOT NULL,
        message         TEXT NOT NULL,
        meta            TEXT NOT NULL DEFAULT '{}',
        acknowledged_at TEXT
      )`,

      `CREATE TABLE IF NOT EXISTS webhook_events (
        provider    TEXT NOT NULL,
        event_id    TEXT NOT NULL,
        received_at TEXT NOT NULL,
        PRIMARY KEY (provider, event_id)
      )`,
    ],
  },
  {
    id: 2,
    name: "scheduling",
    statements: [
      `CREATE TABLE IF NOT EXISTS appointments (
        id           TEXT PRIMARY KEY,
        lead_id      TEXT NOT NULL REFERENCES leads(id),
        kind         TEXT NOT NULL CHECK (kind IN ('sales_call','inspection','cleaning')),
        status       TEXT NOT NULL DEFAULT 'tentative' CHECK (status IN (
                       'tentative','confirmed','rescheduled','completed','cancelled','no_show')),
        starts_at    TEXT NOT NULL,
        ends_at      TEXT NOT NULL,
        timezone     TEXT NOT NULL,
        location     TEXT DEFAULT '',
        ics_sequence INTEGER NOT NULL DEFAULT 0,
        created_by   TEXT NOT NULL,
        notes        TEXT DEFAULT '',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS appts_time ON appointments(status, starts_at)`,

      `CREATE TABLE IF NOT EXISTS availability_rules (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        weekday   INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
        start_min INTEGER NOT NULL,
        end_min   INTEGER NOT NULL,
        kind      TEXT NOT NULL DEFAULT 'any'
      )`,

      `CREATE TABLE IF NOT EXISTS onboarding_forms (
        id           TEXT PRIMARY KEY,
        lead_id      TEXT NOT NULL UNIQUE REFERENCES leads(id),
        token_hash   TEXT NOT NULL UNIQUE,
        status       TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','opened','submitted','expired')),
        data         TEXT,
        sent_at      TEXT NOT NULL,
        opened_at    TEXT,
        submitted_at TEXT
      )`,
    ],
  },
  {
    id: 3,
    name: "voice",
    statements: [
      `CREATE TABLE IF NOT EXISTS call_attempts (
        id                   TEXT PRIMARY KEY,
        lead_id              TEXT NOT NULL REFERENCES leads(id),
        direction            TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
        mode                 TEXT NOT NULL CHECK (mode IN ('ai','human_bridge')),
        purpose              TEXT CHECK (purpose IN (
                               'inbound','quote_followup','appointment_confirmation','marketing','cold_intro')),
        job_id               TEXT REFERENCES jobs(id),
        vapi_call_id         TEXT UNIQUE,
        twilio_call_sid      TEXT UNIQUE,
        consent_tier_snapshot TEXT,
        line_type_snapshot   TEXT,
        dnc_exception_basis  TEXT,
        status               TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                               'queued','ringing','in_progress','completed','no_answer','voicemail','failed')),
        outcome              TEXT,
        disclosure_played    INTEGER NOT NULL DEFAULT 0,
        disclosure_verified  INTEGER NOT NULL DEFAULT 0,
        recording_url        TEXT,
        transcript           TEXT,
        summary              TEXT,
        started_at TEXT, ended_at TEXT, duration_s INTEGER,
        cost_cents           INTEGER,
        created_at           TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS calls_lead ON call_attempts(lead_id, created_at)`,

      `CREATE TABLE IF NOT EXISTS dnc_national (
        phone_e164  TEXT PRIMARY KEY,
        imported_at TEXT NOT NULL
      )`,
    ],
  },
  {
    id: 4,
    name: "discovery",
    statements: [
      `CREATE TABLE IF NOT EXISTS crawl_domains (
        domain            TEXT PRIMARY KEY,
        robots_txt        TEXT,
        robots_fetched_at TEXT,
        crawl_delay_s     INTEGER NOT NULL DEFAULT 3,
        last_crawled_at   TEXT,
        pages_fetched     INTEGER NOT NULL DEFAULT 0,
        denied            INTEGER NOT NULL DEFAULT 0,
        denied_reason     TEXT
      )`,

      `CREATE TABLE IF NOT EXISTS crawl_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        url             TEXT NOT NULL,
        host            TEXT NOT NULL,
        fetched_at      TEXT NOT NULL,
        http_status     INTEGER,
        robots_decision TEXT NOT NULL,
        outcome         TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS contact_points (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id      TEXT NOT NULL REFERENCES leads(id),
        kind         TEXT NOT NULL CHECK (kind IN ('email','phone')),
        value        TEXT NOT NULL,
        source_url   TEXT NOT NULL,
        extracted_at TEXT NOT NULL,
        UNIQUE (lead_id, kind, value)
      )`,
    ],
  },
];
