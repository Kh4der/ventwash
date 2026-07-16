import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import {
  confirmAppointment,
  cancelAppointment,
  completeAppointment,
  rescheduleAppointment,
  hasOverlap,
} from "@/lib/appointments";

/**
 * PATCH /api/admin/appointments/[id] — lifecycle actions dispatched to the
 * appointments kernel: confirm / cancel / complete / no_show / reschedule.
 * Reschedules bump ics_sequence and re-fan reminders inside the helper;
 * cancels kill stale reminder jobs by key prefix. Actor is always 'admin'.
 */

const ACTIONS = new Set(["confirm", "cancel", "complete", "no_show", "reschedule"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) {
    return Response.json(
      { error: "action must be confirm, cancel, complete, no_show or reschedule" },
      { status: 400 },
    );
  }

  try {
    let updated = null;
    if (action === "confirm") {
      updated = await confirmAppointment(id, "admin");
    } else if (action === "cancel") {
      updated = await cancelAppointment(id, "admin");
    } else if (action === "complete") {
      updated = await completeAppointment(id, "admin", "completed");
    } else if (action === "no_show") {
      updated = await completeAppointment(id, "admin", "no_show");
    } else {
      const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
      const endsAt = typeof body.endsAt === "string" ? body.endsAt : "";
      const startMs = new Date(startsAt).getTime();
      const endMs = new Date(endsAt).getTime();
      if (!startsAt || !endsAt || Number.isNaN(startMs) || Number.isNaN(endMs) || startMs >= endMs) {
        return Response.json(
          { error: "reschedule requires valid startsAt/endsAt with startsAt < endsAt" },
          { status: 400 },
        );
      }
      // Same overlap guard as creation — a reschedule must not double-book.
      // Allow force to override, matching POST /api/admin/appointments.
      if (body.force !== true && (await hasOverlap(startsAt, endsAt, id))) {
        return Response.json({ error: "Overlaps an existing appointment", overlap: true }, { status: 409 });
      }
      updated = await rescheduleAppointment(
        id,
        new Date(startMs).toISOString(),
        new Date(endMs).toISOString(),
        "admin",
      );
    }

    if (!updated) return Response.json({ error: "Appointment not found" }, { status: 404 });
    return Response.json({ ok: true, appointment: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Appointment update failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
