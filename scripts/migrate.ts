/**
 * Standalone migration runner. Applies src/db/migrations.ts against whatever
 * database .env.local points at (Turso if TURSO_DATABASE_URL is set, else the
 * local file). Safe to re-run — migrations are tracked in _migrations and
 * skipped once applied.
 *
 * Usage:  npx tsx scripts/migrate.ts
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { MIGRATIONS } from "../src/db/migrations";

function loadEnv() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  const url = process.env.TURSO_DATABASE_URL || "file:./data/ventwash.db";
  if (url.startsWith("file:")) fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
  const c = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  console.log("Migrating:", url.replace(/authToken=[^&]+/, "authToken=***"));

  await c.execute(
    "CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    (await c.execute("SELECT id FROM _migrations")).rows.map((r) => Number(r.id)),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) {
      console.log(`  = migration ${m.id} (${m.name}) already applied`);
      continue;
    }
    await c.batch(
      [...m.statements, { sql: "INSERT INTO _migrations (id, applied_at) VALUES (?, ?)", args: [m.id, new Date().toISOString()] }],
      "write",
    );
    console.log(`  + applied migration ${m.id} (${m.name})`);
  }

  const tables = (
    await c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  ).rows.map((r) => String(r.name));
  console.log(`Done. ${tables.length} tables:`, tables.join(", "));
}

main().catch((e) => {
  console.error("Migration failed:", e.message);
  process.exit(1);
});
