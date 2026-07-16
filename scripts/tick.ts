/**
 * scripts/tick.ts — local queue drain for Windows dev.
 *
 * Usage: `npm run tick` in one terminal alongside `npm run dev` in another.
 * Loops until Ctrl+C, calling GET http://localhost:3000/api/cron/tick every
 * 15 seconds (with `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is
 * set in .env.local or the environment) and printing each tick's JSON
 * summary. This stands in for the production cron pinger — all correctness
 * lives in jobs.run_at + idempotency keys, so any firing cadence is safe.
 *
 * Dependency-free by design: .env.local is read with a tiny hand-rolled
 * parser (no dotenv), and the HTTP call is global fetch (Node 20+).
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const TICK_URL = "http://localhost:3000/api/cron/tick";
const INTERVAL_MS = 15_000;

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
    // No .env.local — fine; fall through to process.env.
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const fileEnv = loadEnvLocal();
  const secret = process.env.CRON_SECRET || fileEnv.CRON_SECRET || "";

  console.log(
    `[tick] draining ${TICK_URL} every ${INTERVAL_MS / 1000}s — Ctrl+C to stop ` +
      (secret ? "(Bearer auth)" : "(no CRON_SECRET — dev-only mode)"),
  );

  for (;;) {
    const at = new Date().toISOString();
    try {
      const res = await fetch(TICK_URL, {
        headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
      });
      const text = await res.text();
      let summary = text.slice(0, 1000);
      try {
        summary = JSON.stringify(JSON.parse(text));
      } catch {
        // Non-JSON body (error page etc.) — print the raw slice.
      }
      console.log(`[tick ${at}] ${res.status} ${summary}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[tick ${at}] fetch failed — is \`npm run dev\` running? (${message})`);
    }
    await sleep(INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error("[tick] fatal:", err);
  process.exit(1);
});
