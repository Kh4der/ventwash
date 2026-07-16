import type { Job } from "@/lib/jobs";
import type { HandlerResult } from "@/lib/job-handlers";
import { getDb, setSetting, nowIso } from "@/lib/db";
import { raiseAlert } from "@/lib/compliance/audit";
import { toE164US } from "@/lib/phone";

/**
 * dnc_sync job handler — weekly National DNC registry import (spec D13, §6.5).
 * Enqueued by GET /api/cron/tick?task=dnc_sync (key `dnc:<YYYY-MM-DD>`).
 *
 * OPERATOR RUNBOOK
 * 1. Buy an FTC SAN subscription for the operating area codes at
 *    https://telemarketing.donotcall.gov and set DNC_SAN=<your SAN>.
 * 2. The FTC's download endpoints sit behind SAN-authenticated, account-specific
 *    flows that cannot be integrated blind, so this handler imports from
 *    DNC_IMPORT_URL instead — either a direct FTC change-list URL your account
 *    is authorized to fetch, or a pre-authorized CSV/TXT export the founders
 *    host. Format: one phone number per line (10 digits; separators like
 *    "202,5551234" are tolerated — all non-digits on a line are ignored).
 * 3. Set DNC_IMPORT_URL=<https URL>. Each run fetches it, INSERT OR IGNOREs
 *    into dnc_national in batches of 500, and stamps settings.dnc_synced_at
 *    ONLY on full success (dncFreshness() reads that stamp; >31 days ⇒
 *    telemarketing dials without a recorded exception are blocked
 *    campaign-wide — fail closed).
 * 4. Change-list DELETIONS are not processed: numbers stay on our mirror,
 *    which is the fail-safe direction (we might skip a number that became
 *    callable again, never dial one that opted out). Reconcile occasionally by
 *    pointing DNC_IMPORT_URL at a full-list export and re-running.
 * 5. While DNC_SAN is unset the handler is a dev no-op that does NOT stamp
 *    dnc_synced_at, so staleness remains true and cold/marketing dialing
 *    stays blocked.
 */
export async function run(job: Job): Promise<HandlerResult> {
  void job;

  if (!process.env.DNC_SAN) {
    console.log(
      "[dev no-op] dnc_sync: DNC_SAN not set — skipping national DNC import " +
        "(dnc_synced_at NOT stamped; cold dialing stays blocked).",
    );
    return { simulated: true };
  }

  const db = await getDb();
  if (!db) return { simulated: true };

  const importUrl = process.env.DNC_IMPORT_URL;
  if (!importUrl) {
    await raiseAlert(
      "warn",
      "dnc_stale",
      "DNC_SAN is set but DNC_IMPORT_URL is missing — cannot download change lists. " +
        "See the operator runbook in src/lib/job-handlers/dnc-sync.ts.",
    );
    throw new Error("dnc_sync: DNC_IMPORT_URL not configured");
  }

  let body: string;
  try {
    const res = await fetch(importUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`DNC change-list fetch failed (${res.status})`);
    }
    body = await res.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await raiseAlert("warn", "dnc_stale", `DNC change-list fetch failed: ${message}`, {
      importUrl,
    });
    throw err;
  }

  // One phone per line; toE164US strips separators and validates NANP shape.
  const lines = body.split(/\r?\n/);
  const numbers: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const e164 = toE164US(trimmed);
    if (e164) numbers.push(e164);
  }

  // A non-empty body that yields zero numbers is almost certainly an error or
  // login page, not a change list — fail loudly rather than stamp freshness.
  if (numbers.length === 0 && body.trim().length > 0) {
    await raiseAlert(
      "warn",
      "dnc_stale",
      "DNC change-list fetch returned content but no parseable phone numbers — not stamping dnc_synced_at.",
      { importUrl, bytes: body.length },
    );
    throw new Error("dnc_sync: fetched content contained no parseable phone numbers");
  }

  const now = nowIso();
  let inserted = 0;
  for (let i = 0; i < numbers.length; i += 500) {
    const batch = numbers.slice(i, i + 500).map((phone) => ({
      sql: "INSERT OR IGNORE INTO dnc_national (phone_e164, imported_at) VALUES (?, ?)",
      args: [phone, now],
    }));
    const results = await db.batch(batch, "write");
    for (const r of results) inserted += r.rowsAffected;
  }

  // Stamp freshness ONLY after every batch committed.
  await setSetting("dnc_synced_at", nowIso());
  await raiseAlert(
    "info",
    "dnc_sync",
    `National DNC sync complete: ${numbers.length} numbers parsed, ${inserted} new.`,
    { parsed: numbers.length, inserted },
  );
}
