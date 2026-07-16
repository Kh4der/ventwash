import { getDb, q, qOne, nowIso } from "@/lib/db";
import { enqueue, cancelByKeyPrefix } from "@/lib/jobs";
import { transition, recordLeadEvent, type Actor } from "@/lib/lead-machine";
import { localTime } from "@/lib/compliance/tz";

/**
 * Appointments are rows in OUR database; calendars (ICS attachments, the
 * founder subscribe feed) are projections of this state. Reminder jobs are
 * created here with idempotency keys that embed the ics_sequence —
 * `appt:<id>:<seq>:<kind>` — so a reschedule cancels stale reminders by key
 * prefix and re-fans cleanly.
 */

export type AppointmentKind = "sales_call" | "inspection" | "cleaning";
export type AppointmentStatus =
  | "tentative"
  | "confirmed"
  | "rescheduled"
  | "completed"
  | "cancelled"
  | "no_show";

export interface Appointment {
  id: string;
  lead_id: string;
  kind: AppointmentKind;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  timezone: string;
  location: string;
  ics_sequence: number;
  created_by: string;
  notes: string;
}

export function businessTimezone(): string {
  return process.env.BUSINESS_TIMEZONE || "America/New_York";
}

/**
 * Canonicalize an instant to UTC ISO ('...Z'). Every timestamp written to or
 * compared in the appointments table must pass through this — stored rows and
 * overlap-check inputs must share one format, or the lexicographic comparison
 * in hasOverlap silently breaks (e.g. an offset like -04:00 vs a Z string),
 * allowing double-booking. Throws on an unparseable value.
 */
export function toUtcIso(value: string): string {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) throw new Error("Invalid datetime: " + value);
  return new Date(t).toISOString();
}

function rowToAppt(r: Record<string, unknown>): Appointment {
  return {
    id: String(r.id),
    lead_id: String(r.lead_id),
    kind: String(r.kind) as AppointmentKind,
    status: String(r.status) as AppointmentStatus,
    starts_at: String(r.starts_at),
    ends_at: String(r.ends_at),
    timezone: String(r.timezone),
    location: String(r.location ?? ""),
    ics_sequence: Number(r.ics_sequence),
    created_by: String(r.created_by),
    notes: String(r.notes ?? ""),
  };
}

export async function getAppointment(id: string): Promise<Appointment | null> {
  const row = await qOne({ sql: "SELECT * FROM appointments WHERE id = ?", args: [id] });
  return row ? rowToAppt(row) : null;
}

/** Reminder fan-out. Past-dated reminders are skipped, not backfilled. */
export async function fanOutReminders(appt: Appointment): Promise<void> {
  const prefix = `appt:${appt.id}:${appt.ics_sequence}:`;
  const starts = new Date(appt.starts_at).getTime();
  const plan: { key: string; type: "send_email" | "send_sms" | "place_ai_call"; at: number; payload: Record<string, unknown> }[] = [
    {
      key: prefix + "confirm_email",
      type: "send_email",
      at: Date.now(),
      payload: { template: "appointment_confirm", appointmentId: appt.id },
    },
    {
      key: prefix + "email_48h",
      type: "send_email",
      at: starts - 48 * 3600_000,
      payload: { template: "appointment_reminder_48h", appointmentId: appt.id },
    },
    {
      key: prefix + "sms_24h",
      type: "send_sms",
      at: starts - 24 * 3600_000,
      payload: { template: "appointment_reminder_24h", appointmentId: appt.id },
    },
    {
      // Only fires if the appointment is still unconfirmed at T-4h — the
      // handler re-checks status and consent before dialing.
      key: prefix + "call_4h",
      type: "place_ai_call",
      at: starts - 4 * 3600_000,
      payload: { purpose: "appointment_confirmation", appointmentId: appt.id },
    },
  ];
  for (const p of plan) {
    if (p.at < Date.now() - 60_000 && p.key !== prefix + "confirm_email") continue;
    await enqueue({
      type: p.type,
      payload: p.payload,
      leadId: appt.lead_id,
      runAt: new Date(Math.max(p.at, Date.now())).toISOString(),
      idempotencyKey: p.key,
    });
  }
}

export interface NewAppointment {
  leadId: string;
  kind: AppointmentKind;
  startsAt: string;
  endsAt: string;
  location?: string;
  notes?: string;
  createdBy: "admin" | "vapi" | "customer" | "system";
  /** Tentative drafts (e.g. auto-drafted inspections) defer reminders until confirmed. */
  status?: "tentative" | "confirmed";
  skipReminders?: boolean;
}

export async function createAppointment(input: NewAppointment): Promise<Appointment | null> {
  const db = await getDb();
  if (!db) return null;
  const id = crypto.randomUUID();
  const now = nowIso();
  const status = input.status ?? "tentative";
  const startsAt = toUtcIso(input.startsAt);
  const endsAt = toUtcIso(input.endsAt);

  await db.execute({
    sql: `INSERT INTO appointments (id, lead_id, kind, status, starts_at, ends_at, timezone, location, created_by, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, input.leadId, input.kind, status, startsAt, endsAt,
      businessTimezone(), input.location ?? "", input.createdBy, input.notes ?? "", now, now,
    ],
  });

  // Booking moves an engaged lead forward; tolerate leads already there.
  try {
    await transition(input.leadId, "appointment_scheduled", input.createdBy as Actor, {
      appointmentId: id,
    });
  } catch {
    await recordLeadEvent(input.leadId, "note", "system", {
      note: "appointment created outside engaged state",
      appointmentId: id,
    });
  }

  const appt = (await getAppointment(id))!;
  if (!input.skipReminders) await fanOutReminders(appt);
  return appt;
}

export async function confirmAppointment(id: string, actor: Actor): Promise<Appointment | null> {
  const appt = await getAppointment(id);
  if (!appt) return null;
  if (appt.status === "tentative" || appt.status === "rescheduled") {
    await q({
      sql: "UPDATE appointments SET status = 'confirmed', updated_at = ? WHERE id = ?",
      args: [nowIso(), id],
    });
    await recordLeadEvent(appt.lead_id, "note", actor, { note: "appointment confirmed", appointmentId: id });
    // A confirmed drafted inspection advances the onboarding pipeline.
    if (appt.kind === "inspection") {
      try {
        await transition(appt.lead_id, "inspection_scheduled", actor, { appointmentId: id });
      } catch {
        /* lead not in onboarded state — fine */
      }
      const confirmed = (await getAppointment(id))!;
      await fanOutReminders(confirmed);
    }
  }
  return getAppointment(id);
}

export async function rescheduleAppointment(
  id: string,
  startsAt: string,
  endsAt: string,
  actor: Actor,
): Promise<Appointment | null> {
  const appt = await getAppointment(id);
  if (!appt) return null;
  const startsUtc = toUtcIso(startsAt);
  const endsUtc = toUtcIso(endsAt);
  await cancelByKeyPrefix(`appt:${id}:`);
  await q({
    sql: `UPDATE appointments SET starts_at = ?, ends_at = ?, status = 'rescheduled',
            ics_sequence = ics_sequence + 1, updated_at = ? WHERE id = ?`,
    args: [startsUtc, endsUtc, nowIso(), id],
  });
  const updated = (await getAppointment(id))!;
  await recordLeadEvent(appt.lead_id, "note", actor, {
    note: "appointment rescheduled",
    appointmentId: id,
    startsAt: startsUtc,
  });
  await fanOutReminders(updated);
  return updated;
}

export async function cancelAppointment(id: string, actor: Actor): Promise<Appointment | null> {
  const appt = await getAppointment(id);
  if (!appt) return null;
  await cancelByKeyPrefix(`appt:${id}:`);
  await q({
    sql: "UPDATE appointments SET status = 'cancelled', updated_at = ? WHERE id = ?",
    args: [nowIso(), id],
  });
  try {
    await transition(appt.lead_id, "engaged", actor, { appointmentId: id, reason: "cancelled" });
  } catch {
    /* lead may have moved on; timeline note is enough */
  }
  await recordLeadEvent(appt.lead_id, "note", actor, { note: "appointment cancelled", appointmentId: id });
  return getAppointment(id);
}

export async function completeAppointment(
  id: string,
  actor: Actor,
  outcome: "completed" | "no_show",
): Promise<Appointment | null> {
  const appt = await getAppointment(id);
  if (!appt) return null;
  await q({
    sql: "UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?",
    args: [outcome, nowIso(), id],
  });
  if (outcome === "no_show") {
    try {
      await transition(appt.lead_id, "engaged", actor, { appointmentId: id, reason: "no_show" });
    } catch {
      /* fine */
    }
  } else if (appt.kind === "inspection") {
    try {
      await transition(appt.lead_id, "customer", actor, { appointmentId: id });
    } catch {
      /* lead not in inspection_scheduled — founder can transition manually */
    }
  }
  await recordLeadEvent(appt.lead_id, "note", actor, { note: "appointment " + outcome, appointmentId: id });
  return getAppointment(id);
}

/* ── Availability ───────────────────────────────────────────────────────── */

export interface Slot {
  startsAt: string;
  endsAt: string;
}

const DEFAULT_RULES = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  start_min: 9 * 60,
  end_min: 17 * 60,
}));

/**
 * Hourly open slots over the next `days`, computed in the business timezone
 * against availability_rules (Mon–Fri 9–17 default) minus existing
 * appointments. Used by the Vapi book_appointment tool and the customer
 * reschedule page.
 */
export async function getAvailableSlots(days = 10, slotMinutes = 60): Promise<Slot[]> {
  const db = await getDb();
  if (!db) return [];
  let rules = (await q("SELECT weekday, start_min, end_min FROM availability_rules")).map((r) => ({
    weekday: Number(r.weekday),
    start_min: Number(r.start_min),
    end_min: Number(r.end_min),
  }));
  if (!rules.length) rules = DEFAULT_RULES;

  const tz = businessTimezone();
  const horizon = Date.now() + days * 24 * 3600_000;
  const busy = (
    await q({
      sql: `SELECT starts_at, ends_at FROM appointments
            WHERE status IN ('tentative','confirmed','rescheduled') AND ends_at >= ?`,
      args: [nowIso()],
    })
  ).map((r) => ({ s: new Date(String(r.starts_at)).getTime(), e: new Date(String(r.ends_at)).getTime() }));

  const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const slots: Slot[] = [];
  // Walk hour boundaries in UTC; include those whose LOCAL time matches a rule.
  const startHourUtc = Math.ceil(Date.now() / 3600_000) * 3600_000 + 3600_000; // from next full hour + 1h lead time
  for (let t = startHourUtc; t < horizon && slots.length < 60; t += 3600_000) {
    const at = new Date(t);
    const { hour, minute } = localTime(tz, at);
    if (minute !== 0) continue; // only whole local hours (handles :30 offset zones by skipping)
    const weekday = WEEKDAYS.indexOf(weekdayFmt.format(at));
    const startMin = hour * 60;
    const endMin = startMin + slotMinutes;
    const fits = rules.some((r) => r.weekday === weekday && startMin >= r.start_min && endMin <= r.end_min);
    if (!fits) continue;
    const slotEnd = t + slotMinutes * 60_000;
    const overlaps = busy.some((b) => t < b.e && slotEnd > b.s);
    if (overlaps) continue;
    slots.push({ startsAt: new Date(t).toISOString(), endsAt: new Date(slotEnd).toISOString() });
  }
  return slots;
}

/**
 * Overlap check used by admin create/edit. Inputs are canonicalized to UTC ISO
 * so the string comparison matches the stored ('...Z') rows — callers may pass
 * raw request-body values in any offset/zone-less format.
 */
export async function hasOverlap(startsAt: string, endsAt: string, excludeId?: string): Promise<boolean> {
  const s = toUtcIso(startsAt);
  const e = toUtcIso(endsAt);
  const row = await qOne({
    sql: `SELECT id FROM appointments
          WHERE status IN ('tentative','confirmed','rescheduled')
            AND starts_at < ? AND ends_at > ? AND id != ? LIMIT 1`,
    args: [e, s, excludeId ?? ""],
  });
  return row !== null;
}
