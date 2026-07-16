import { createClient, type Client, type InStatement } from "@libsql/client";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "@/db/migrations";

/**
 * libSQL database singleton — the ONLY file that imports @libsql/client.
 *
 * Resolution order (docs/automation-platform-spec.md D2):
 *  - TURSO_DATABASE_URL set          → Turso over HTTPS (durable, prod).
 *  - running on Vercel without Turso → null. Serverless filesystems are
 *    ephemeral; silently losing consent records is a compliance failure, so
 *    we fail closed: every DB consumer must treat null as "unconfigured"
 *    (the { configured: false } shape /api/admin/stats already uses) and
 *    every outbound channel reads as OFF.
 *  - otherwise                       → file:./data/ventwash.db (zero-config
 *    local dev and self-hosted Node; gitignored, auto-created, auto-migrated).
 *
 * Escape hatches if the @libsql/client win32 prebuilt ever lags a Node major:
 * `turso dev` (local HTTP server — set TURSO_DATABASE_URL=http://127.0.0.1:8080)
 * or swap this file's driver for node:sqlite. Nothing else imports the driver.
 */

let client: Client | null | undefined;
let migrated: Promise<void> | null = null;

function resolveClient(): Client | null {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) {
    return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  if (process.env.VERCEL) {
    console.warn(
      "[db] Running on Vercel without TURSO_DATABASE_URL — database disabled (fail closed).",
    );
    return null;
  }
  const dir = path.join(process.cwd(), "data");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // If the directory can't be created, createClient will surface the error.
  }
  return createClient({ url: "file:" + path.join(dir, "ventwash.db") });
}

async function migrate(c: Client): Promise<void> {
  await c.execute(
    "CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    (await c.execute("SELECT id FROM _migrations")).rows.map((r) => Number(r.id)),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await c.batch(
      [
        ...m.statements,
        {
          sql: "INSERT INTO _migrations (id, applied_at) VALUES (?, ?)",
          args: [m.id, new Date().toISOString()],
        },
      ],
      "write",
    );
    console.log(`[db] applied migration ${m.id} (${m.name})`);
  }
}

/**
 * Returns the migrated database client, or null when no durable database is
 * available (Vercel without Turso). Callers must handle null by reporting
 * "unconfigured" and skipping all side effects.
 */
export async function getDb(): Promise<Client | null> {
  if (client === undefined) client = resolveClient();
  if (client === null) return null;
  if (!migrated) {
    migrated = migrate(client).catch((err) => {
      migrated = null; // allow retry on next call
      throw err;
    });
  }
  await migrated;
  return client;
}

/** ISO-8601 UTC timestamp — the canonical time format for every table. */
export function nowIso(): string {
  return new Date().toISOString();
}

type Row = Record<string, unknown>;

/** Run a statement and return all rows as plain objects. */
export async function q(stmt: InStatement): Promise<Row[]> {
  const db = await getDb();
  if (!db) return [];
  const res = await db.execute(stmt);
  return res.rows as unknown as Row[];
}

/** Run a statement and return the first row, or null. */
export async function qOne(stmt: InStatement): Promise<Row | null> {
  const rows = await q(stmt);
  return rows[0] ?? null;
}

/** Run several statements atomically (single transaction). No-op when DB is null. */
export async function tx(stmts: InStatement[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.batch(stmts, "write");
}

/** settings table helpers */
export async function getSetting(key: string): Promise<string | null> {
  const row = await qOne({ sql: "SELECT value FROM settings WHERE key = ?", args: [key] });
  return row ? String(row.value) : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await q({
    sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [key, value],
  });
}
