import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb, q, qOne, nowIso } from "@/lib/db";

/**
 * POST /api/webhooks/resend — Resend delivery webhooks (svix-signed).
 *
 * Verifies the svix signature by hand (no npm dependency): signed content is
 * `${svix-id}.${svix-timestamp}.${rawBody}`, key is the base64 portion of
 * RESEND_WEBHOOK_SECRET after the "whsec_" prefix, HMAC-SHA256 base64,
 * compared timing-safe against each space-separated `v1,<sig>` entry.
 * Timestamps older/newer than 5 minutes are rejected. Unset secret ⇒ 503 in
 * production, accept-without-verify in dev (with a loud warning).
 *
 * Events are deduped via webhook_events (provider 'resend', event_id =
 * svix-id). email.delivered/bounced/complained update messages.status via
 * provider_id; bounce/complaint additionally insert email_suppressions so
 * the sendEmail choke point never mails that address again.
 */

const MAX_SKEW_SECONDS = 5 * 60;

function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const STATUS_BY_TYPE: Record<string, string> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const svixId = (request.headers.get("svix-id") ?? "").slice(0, 256);
  const svixTimestamp = (request.headers.get("svix-timestamp") ?? "").slice(0, 32);
  const svixSignature = (request.headers.get("svix-signature") ?? "").slice(0, 4096);

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return Response.json({ error: "Webhook secret not configured" }, { status: 503 });
    }
    console.warn(
      "[resend webhook] RESEND_WEBHOOK_SECRET unset — accepting WITHOUT verification (dev only)",
    );
  } else {
    if (!svixId || !svixTimestamp || !svixSignature) {
      return Response.json({ error: "Missing svix headers" }, { status: 401 });
    }
    const ts = Number(svixTimestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_SECONDS) {
      return Response.json({ error: "Timestamp outside tolerance" }, { status: 401 });
    }
    const keyB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
    const key = Buffer.from(keyB64, "base64");
    const expected = createHmac("sha256", key)
      .update(`${svixId}.${svixTimestamp}.${rawBody}`)
      .digest("base64");
    const verified = svixSignature
      .split(" ")
      .some((part) => timingSafeEq(part.includes(",") ? part.slice(part.indexOf(",") + 1) : part, expected));
    if (!verified) {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // Parse defensively — a malformed body from a verified sender is still a 400.
  let event: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    event = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const db = await getDb();
  if (!db) return Response.json({ ok: true, note: "db unconfigured" }); // nothing durable to update

  // Dedupe (svix retries + out-of-order delivery). Dev-unverified requests
  // may lack an id; fall back to a random one so they still process once.
  const eventId = svixId || crypto.randomUUID();
  const inserted = await db.execute({
    sql: "INSERT OR IGNORE INTO webhook_events (provider, event_id, received_at) VALUES ('resend', ?, ?)",
    args: [eventId, nowIso()],
  });
  if (inserted.rowsAffected === 0) return Response.json({ ok: true, deduped: true });

  // The suppression insert below is the important side effect; if it (or the
  // status update) throws after we've claimed the dedupe row, release the claim
  // so the svix retry re-processes instead of being deduped away.
  try {
    const type = String(event.type ?? "").slice(0, 64);
    const data =
      event.data && typeof event.data === "object" && !Array.isArray(event.data)
        ? (event.data as Record<string, unknown>)
        : {};
    const emailId = typeof data.email_id === "string" ? data.email_id.slice(0, 256) : "";
    const status = STATUS_BY_TYPE[type];

    if (status && emailId) {
      const msg = await qOne({
        sql: "SELECT id, to_addr FROM messages WHERE provider_id = ?",
        args: [emailId],
      });
      if (msg) {
        await q({
          sql: "UPDATE messages SET status = ? WHERE id = ?",
          args: [status, String(msg.id)],
        });
      }

      if (type === "email.bounced" || type === "email.complained") {
        let addr = msg ? String(msg.to_addr ?? "") : "";
        if (!addr) {
          // Fall back to the webhook payload when the send predates our ledger.
          const toField = data.to;
          if (Array.isArray(toField) && typeof toField[0] === "string") addr = toField[0];
          else if (typeof toField === "string") addr = toField;
        }
        addr = addr.trim().toLowerCase().slice(0, 320);
        if (addr.includes("@")) {
          await q({
            sql: `INSERT OR IGNORE INTO email_suppressions (email, reason, source, added_at)
                  VALUES (?, ?, 'resend_webhook', ?)`,
            args: [addr, type === "email.bounced" ? "hard_bounce" : "complaint", nowIso()],
          });
        }
      }
    }
  } catch (err) {
    await db
      .execute({
        sql: "DELETE FROM webhook_events WHERE provider = 'resend' AND event_id = ?",
        args: [eventId],
      })
      .catch(() => {});
    console.error("[resend webhook] processing failed:", err);
    return Response.json({ error: "processing failed" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
