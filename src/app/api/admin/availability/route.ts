import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb, q, tx } from "@/lib/db";

/**
 * /api/admin/availability — the weekly availability-rules editor. GET returns
 * rules ordered by weekday/start; PUT validates and replaces the whole set in
 * one transaction (rules are small and few — replace-all beats diffing).
 */

const MAX_RULES_PER_WEEKDAY = 4;

interface Rule {
  weekday: number;
  start_min: number;
  end_min: number;
}

async function listRules() {
  const rows = await q(
    "SELECT id, weekday, start_min, end_min FROM availability_rules ORDER BY weekday, start_min",
  );
  return rows.map((r) => ({
    id: Number(r.id),
    weekday: Number(r.weekday),
    start_min: Number(r.start_min),
    end_min: Number(r.end_min),
  }));
}

export async function GET() {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  try {
    return Response.json({ configured: true, rules: await listRules() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Availability query failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.rules)) {
    return Response.json({ error: "rules must be an array" }, { status: 400 });
  }

  const rules: Rule[] = [];
  const perWeekday = new Map<number, number>();
  for (const raw of body.rules as unknown[]) {
    if (!raw || typeof raw !== "object") {
      return Response.json({ error: "Each rule must be an object" }, { status: 400 });
    }
    const r = raw as Record<string, unknown>;
    const weekday = Number(r.weekday);
    const start_min = Number(r.start_min);
    const end_min = Number(r.end_min);
    if (
      !Number.isInteger(weekday) || weekday < 0 || weekday > 6 ||
      !Number.isInteger(start_min) || start_min < 0 || start_min > 1440 ||
      !Number.isInteger(end_min) || end_min < 0 || end_min > 1440 ||
      start_min >= end_min
    ) {
      return Response.json(
        { error: "Each rule needs weekday 0-6 and 0-1440 minutes with start_min < end_min" },
        { status: 400 },
      );
    }
    const count = (perWeekday.get(weekday) ?? 0) + 1;
    if (count > MAX_RULES_PER_WEEKDAY) {
      return Response.json(
        { error: `At most ${MAX_RULES_PER_WEEKDAY} rules per weekday` },
        { status: 400 },
      );
    }
    perWeekday.set(weekday, count);
    rules.push({ weekday, start_min, end_min });
  }

  try {
    await tx([
      "DELETE FROM availability_rules",
      ...rules.map((r) => ({
        sql: "INSERT INTO availability_rules (weekday, start_min, end_min) VALUES (?, ?, ?)",
        args: [r.weekday, r.start_min, r.end_min],
      })),
    ]);
    return Response.json({ ok: true, rules: await listRules() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Availability update failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
