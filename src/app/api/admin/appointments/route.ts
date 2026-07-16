import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb, q } from "@/lib/db";
import { getLead } from "@/lib/leads";
import {
  createAppointment,
  hasOverlap,
  type AppointmentKind,
} from "@/lib/appointments";

/**
 * /api/admin/appointments — GET lists a date range (default now → +14d) with
 * business names and each appointment's reminder-job statuses (keys
 * 'appt:<id>:<seq>:<kind>'); POST creates one through createAppointment,
 * which fans out confirmation + reminders. Overlaps 409 unless force:true.
 */

const KINDS = new Set<string>(["sales_call", "inspection", "cleaning"]);

function parseIsoOr(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  const url = new URL(request.url);
  const now = new Date();
  const from = parseIsoOr(url.searchParams.get("from"), now).toISOString();
  const to = parseIsoOr(
    url.searchParams.get("to"),
    new Date(now.getTime() + 14 * 24 * 3600_000),
  ).toISOString();

  try {
    const [appts, reminderJobs] = await Promise.all([
      q({
        sql: `SELECT a.*, l.business_name
              FROM appointments a
              LEFT JOIN leads l ON l.id = a.lead_id
              WHERE a.starts_at >= ? AND a.starts_at <= ?
              ORDER BY a.starts_at ASC`,
        args: [from, to],
      }),
      q(
        `SELECT id, idempotency_key, type, status, run_at, last_error, block_reason
         FROM jobs WHERE idempotency_key LIKE 'appt:%'`,
      ),
    ]);

    // Group reminder jobs by the appointment id embedded in the key.
    const remindersByAppt = new Map<string, Record<string, unknown>[]>();
    for (const j of reminderJobs) {
      const key = String(j.idempotency_key ?? "");
      const apptId = key.split(":")[1] ?? "";
      if (!apptId) continue;
      const list = remindersByAppt.get(apptId) ?? [];
      list.push({
        id: String(j.id),
        idempotency_key: key,
        type: String(j.type),
        status: String(j.status),
        run_at: String(j.run_at),
        last_error: j.last_error ? String(j.last_error) : null,
        block_reason: j.block_reason ? String(j.block_reason) : null,
      });
      remindersByAppt.set(apptId, list);
    }

    return Response.json({
      configured: true,
      from,
      to,
      appointments: appts.map((a) => ({
        ...a,
        leadBusiness: String(a.business_name ?? ""),
        reminders: remindersByAppt.get(String(a.id)) ?? [],
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Appointments query failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
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

  const leadId = typeof body.leadId === "string" ? body.leadId : "";
  const kind = typeof body.kind === "string" ? body.kind : "";
  const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
  const endsAt = typeof body.endsAt === "string" ? body.endsAt : "";
  const location = typeof body.location === "string" ? body.location.trim().slice(0, 500) : "";
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : "";

  if (!leadId) return Response.json({ error: "leadId is required" }, { status: 400 });
  if (!KINDS.has(kind)) {
    return Response.json({ error: "kind must be sales_call, inspection or cleaning" }, { status: 400 });
  }
  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(endsAt).getTime();
  if (!startsAt || !endsAt || Number.isNaN(startMs) || Number.isNaN(endMs) || startMs >= endMs) {
    return Response.json({ error: "startsAt/endsAt must be valid with startsAt < endsAt" }, { status: 400 });
  }

  try {
    const lead = await getLead(leadId);
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });

    if (!body.force && (await hasOverlap(startsAt, endsAt))) {
      return Response.json(
        { error: "Overlaps an existing appointment", overlap: true },
        { status: 409 },
      );
    }

    const appointment = await createAppointment({
      leadId,
      kind: kind as AppointmentKind,
      startsAt: new Date(startMs).toISOString(),
      endsAt: new Date(endMs).toISOString(),
      location,
      notes,
      createdBy: "admin",
      status: body.confirmed ? "confirmed" : "tentative",
    });
    if (!appointment) return Response.json({ configured: false });

    return Response.json({ ok: true, appointment });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Appointment creation failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
