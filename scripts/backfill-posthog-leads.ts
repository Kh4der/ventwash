/**
 * scripts/backfill-posthog-leads.ts — ONE-TIME import of historical PostHog
 * `quote_submitted` events into the leads table (spec D20).
 *
 * Usage: `npx tsx scripts/backfill-posthog-leads.ts` from the repo root.
 * Needs POSTHOG_PERSONAL_API_KEY (Query Read scope) and POSTHOG_PROJECT_ID in
 * .env.local or the environment. Writes to TURSO_DATABASE_URL when set, else
 * file:./data/ventwash.db — the same resolution as src/lib/db.ts. Run
 * `npm run dev` once first so migrations have created the tables.
 *
 * Per event: insert a lead (discovery_source 'inbound_form', status
 * 'engaged', consent tier 'express') plus a consent_events row (source
 * 'quote_form', captured_at = the original event timestamp) and a
 * lead_events 'created' timeline row. Idempotent: leads use
 * ON CONFLICT(dedupe_key) DO NOTHING and consent/timeline rows are only
 * written for newly inserted leads — safe to re-run. Tombstoned (privacy-
 * deleted) contacts are skipped, mirroring src/lib/leads.ts.
 *
 * Dependency-free by design: raw fetch against the PostHog query API (the
 * runHogQL shape from src/lib/posthog-api.ts, inlined — Next-aliased modules
 * can't be imported here), @libsql/client directly, and a tiny hand-rolled
 * .env.local parser (no dotenv).
 */

import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
// Relative import of a pure, alias-free module — stays in sync with the app.
import { toE164US } from "../src/lib/phone";

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

/** Tiny .env.local parser: KEY=value lines, # comments, optional quotes. */
function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }
      if (key) out[key] = value;
    }
  } catch {
    // No .env.local — fall through to process.env.
  }
  return out;
}

const fileEnv = loadEnvLocal();
function env(key: string): string {
  return process.env[key] || fileEnv[key] || "";
}

// ---------------------------------------------------------------------------
// PostHog query API (fetch shape copied from src/lib/posthog-api.ts runHogQL)
// ---------------------------------------------------------------------------

async function runHogQL(
  query: string,
): Promise<{ columns: string[]; results: unknown[][] }> {
  const host = env("POSTHOG_API_HOST") || "https://us.posthog.com";
  const url = host + "/api/projects/" + env("POSTHOG_PROJECT_ID") + "/query/";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env("POSTHOG_PERSONAL_API_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error("PostHog query failed (" + res.status + "): " + text.slice(0, 300));
  }

  const data = (await res.json()) as { columns: string[]; results: unknown[][] };
  return { columns: data.columns, results: data.results };
}

// ---------------------------------------------------------------------------
// Identity helpers (dedupeKey MIRRORS src/lib/leads.ts — keep in sync)
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * First non-empty of: E.164 phone | lower(email) | name-slug. Mirrors the
 * dedupeKey scheme in src/lib/leads.ts (quote events carry no website or
 * location, so those branches collapse: the website branch never fires and
 * the location suffix is empty).
 */
function backfillDedupeKey(businessName: string, phone: string, email: string): string {
  const e164 = toE164US(phone);
  if (e164) return "p:" + e164;
  const mail = email.trim().toLowerCase();
  if (mail) return "e:" + mail;
  return "n:" + slug(businessName) + "@";
}

function str(v: unknown, maxLen: number): string {
  if (v === null || v === undefined) return "";
  return String(v).trim().slice(0, maxLen);
}

/** Normalize a PostHog timestamp to ISO-8601 UTC; fall back to now. */
function toIso(v: unknown): string {
  const raw = str(v, 64);
  if (raw) {
    let s = raw.replace(" ", "T");
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!env("POSTHOG_PERSONAL_API_KEY") || !env("POSTHOG_PROJECT_ID")) {
    console.error(
      "Missing POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID (set them in .env.local).",
    );
    process.exit(1);
  }

  // Same DB resolution as src/lib/db.ts (minus the Vercel guard — this is a
  // founder-run local script, never a serverless function).
  const tursoUrl = env("TURSO_DATABASE_URL");
  const db = tursoUrl
    ? createClient({ url: tursoUrl, authToken: env("TURSO_AUTH_TOKEN") || undefined })
    : createClient({ url: "file:" + path.join(process.cwd(), "data", "ventwash.db") });
  console.log("[backfill] database:", tursoUrl ? tursoUrl : "file:./data/ventwash.db");

  const LIMIT = 10_000;
  const { results } = await runHogQL(
    `SELECT timestamp,
            properties.name, properties.business, properties.phone,
            properties.email, properties.hoods, properties.message,
            distinct_id
     FROM events
     WHERE event = 'quote_submitted'
     ORDER BY timestamp ASC
     LIMIT ${LIMIT}`,
  );
  console.log(`[backfill] fetched ${results.length} quote_submitted events`);
  if (results.length >= LIMIT) {
    console.warn(`[backfill] hit the ${LIMIT}-row limit — re-run after narrowing by date.`);
  }

  const DISCLOSURE = "Backfilled historical quote form submission";
  let inserted = 0;
  let deduped = 0;
  let skipped = 0;
  let tombstoned = 0;

  for (const row of results) {
    const [ts, nameV, businessV, phoneV, emailV, hoodsV, messageV, distinctV] = row;
    const name = str(nameV, 200);
    const business = str(businessV, 200);
    const phone = str(phoneV, 200);
    const email = str(emailV, 200).toLowerCase();
    const hoods = str(hoodsV, 200);
    const message = str(messageV, 2000);
    const distinctId = str(distinctV, 200);
    const capturedAt = toIso(ts);

    // Mirror the form's own validation: a lead needs a name and a way to reach it.
    if (!name || (!phone && !email)) {
      skipped++;
      continue;
    }

    const businessName = business || name;
    const e164 = toE164US(phone);

    // Tombstone check — never re-create a privacy-deleted contact.
    const hashes: string[] = [];
    if (e164) hashes.push(sha256("p:" + e164));
    if (email) hashes.push(sha256("e:" + email));
    if (hashes.length) {
      const hit = await db.execute({
        sql: `SELECT hash FROM tombstones WHERE hash IN (${hashes.map(() => "?").join(",")}) LIMIT 1`,
        args: hashes,
      });
      if (hit.rows.length > 0) {
        tombstoned++;
        continue;
      }
    }

    const id = crypto.randomUUID();
    const res = await db.execute({
      sql: `INSERT INTO leads (
              id, created_at, updated_at, status, discovery_source,
              business_name, contact_name, phone_e164, email, hoods, notes,
              consent_tier, approval, posthog_distinct_id, dedupe_key
            ) VALUES (?, ?, ?, 'engaged', 'inbound_form', ?, ?, ?, ?, ?, ?, 'express', 'not_required', ?, ?)
            ON CONFLICT(dedupe_key) WHERE deleted_at IS NULL DO NOTHING`,
      args: [
        id, capturedAt, capturedAt,
        businessName, name, e164, email || null, hoods, message,
        distinctId || null,
        backfillDedupeKey(businessName, phone, email),
      ],
    });

    if (res.rowsAffected === 0) {
      // Dedupe hit (or a repeat run) — don't duplicate the consent trail.
      deduped++;
      continue;
    }

    await db.batch(
      [
        {
          sql: `INSERT INTO consent_events (lead_id, tier, channel_scope, captured_at, source, disclosure_text, raw_payload)
                VALUES (?, 'express', 'all', ?, 'quote_form', ?, ?)`,
          args: [
            id, capturedAt, DISCLOSURE,
            JSON.stringify({ name, business, phone, email, hoods, backfilled: true }),
          ],
        },
        {
          sql: `INSERT INTO lead_events (lead_id, at, type, to_status, actor, meta)
                VALUES (?, ?, 'created', 'engaged', 'system', ?)`,
          args: [id, capturedAt, JSON.stringify({ source: "inbound_form", backfilled: true })],
        },
      ],
      "write",
    );
    inserted++;
  }

  console.log(
    `[backfill] done: ${inserted} leads inserted, ${deduped} deduped onto existing leads, ` +
      `${tombstoned} skipped (tombstoned), ${skipped} skipped (unusable rows).`,
  );
}

main().catch((err) => {
  console.error("[backfill] fatal:", err instanceof Error ? err.message : err);
  console.error(
    "[backfill] hint: if the error is 'no such table', run `npm run dev` once so migrations apply.",
  );
  process.exit(1);
});
