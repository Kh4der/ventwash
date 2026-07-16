import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb, q, qOne } from "@/lib/db";
import { getLead, updateLeadFields, deleteLead } from "@/lib/leads";
import { deleteVapiCallArtifacts } from "@/lib/voice/vapi";

/**
 * /api/admin/leads/[id] — single-lead detail (GET: lead + full timeline +
 * calls + messages + contact points + consent trail + appointments +
 * onboarding form), whitelisted field edits (PATCH — never status; that goes
 * through /transition), and privacy deletion (DELETE: deleteLead cascade plus
 * best-effort Vapi artifact cleanup).
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  const { id } = await params;

  try {
    const lead = await getLead(id);
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });

    const [events, calls, messages, contactPoints, consentEvents, appointments, onboarding] =
      await Promise.all([
        q({
          sql: "SELECT * FROM lead_events WHERE lead_id = ? ORDER BY id DESC LIMIT 100",
          args: [id],
        }),
        q({
          sql: "SELECT * FROM call_attempts WHERE lead_id = ? ORDER BY created_at DESC LIMIT 20",
          args: [id],
        }),
        q({
          sql: "SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at DESC LIMIT 50",
          args: [id],
        }),
        q({
          sql: "SELECT id, lead_id, kind, value, source_url, extracted_at FROM contact_points WHERE lead_id = ?",
          args: [id],
        }),
        q({
          sql: "SELECT * FROM consent_events WHERE lead_id = ? ORDER BY id DESC",
          args: [id],
        }),
        q({
          sql: "SELECT * FROM appointments WHERE lead_id = ? ORDER BY starts_at DESC",
          args: [id],
        }),
        qOne({
          // token_hash deliberately not exposed.
          sql: `SELECT id, lead_id, status, data, sent_at, opened_at, submitted_at
                FROM onboarding_forms WHERE lead_id = ?`,
          args: [id],
        }),
      ]);

    return Response.json({
      configured: true,
      lead,
      events,
      calls,
      messages,
      contactPoints,
      consentEvents,
      appointments,
      onboarding,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lead detail query failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

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
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const lead = await getLead(id);
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });

    // Clamp string values; updateLeadFields applies the editable-column
    // whitelist (status/consent/approval structurally cannot be set here).
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "string") fields[k] = v.trim().slice(0, 2000);
      else if (v === null) fields[k] = null;
    }
    delete fields.status;
    delete fields.consent_tier;
    delete fields.approval;

    await updateLeadFields(id, fields);

    return Response.json({ ok: true, lead: await getLead(id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lead update failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  const { id } = await params;

  try {
    // Snapshot provider call ids before the privacy cascade runs.
    const vapiIds = (
      await q({
        sql: "SELECT vapi_call_id FROM call_attempts WHERE lead_id = ? AND vapi_call_id IS NOT NULL",
        args: [id],
      })
    ).map((r) => String(r.vapi_call_id));

    const ok = await deleteLead(id, "admin");
    if (!ok) return Response.json({ error: "Lead not found" }, { status: 404 });

    // Best-effort provider cascade — failures never undo the local deletion.
    for (const vapiId of vapiIds) {
      try {
        await deleteVapiCallArtifacts(vapiId);
      } catch {
        /* best effort */
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lead deletion failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
