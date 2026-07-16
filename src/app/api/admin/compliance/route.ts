import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb, q, qOne } from "@/lib/db";
import { listChannelFlags } from "@/lib/flags";
import { dncFreshness } from "@/lib/compliance/dnc";
import { vapiConfigured } from "@/lib/voice/vapi";

/**
 * GET /api/admin/compliance — the Compliance tab's single data feed: channel
 * flags, unacknowledged alerts, DNC freshness + counts, suppressions,
 * revocations, the recent call log with consent snapshots and disclosure
 * verification, provider-health (configured vs no-op), and the audit tail.
 */

function parseMeta(v: unknown): Record<string, unknown> {
  try {
    return JSON.parse(String(v ?? "{}"));
  } catch {
    return {};
  }
}

export async function GET() {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  try {
    const [
      flags,
      alerts,
      freshness,
      internalRow,
      nationalRow,
      suppressions,
      revocations,
      recentCalls,
      auditTail,
    ] = await Promise.all([
      listChannelFlags(),
      q(
        `SELECT id, at, severity, kind, message, meta, acknowledged_at
         FROM admin_alerts WHERE acknowledged_at IS NULL
         ORDER BY id DESC LIMIT 50`,
      ),
      dncFreshness(),
      qOne("SELECT COUNT(*) AS n FROM dnc_internal"),
      qOne("SELECT COUNT(*) AS n FROM dnc_national"),
      q("SELECT email, reason, source, added_at FROM email_suppressions ORDER BY added_at DESC LIMIT 100"),
      q(
        `SELECT id, lead_id, phone_e164, email, channel, source, evidence, revoked_at
         FROM revocations ORDER BY id DESC LIMIT 100`,
      ),
      q(
        `SELECT c.id, c.lead_id, l.business_name, c.direction, c.mode, c.purpose,
                c.status, c.outcome, c.consent_tier_snapshot, c.line_type_snapshot,
                c.dnc_exception_basis, c.disclosure_played, c.disclosure_verified,
                c.duration_s, c.cost_cents, c.created_at
         FROM call_attempts c
         LEFT JOIN leads l ON l.id = c.lead_id
         ORDER BY c.created_at DESC LIMIT 50`,
      ),
      q(
        `SELECT id, at, actor, action, lead_id, channel, consent_tier, payload_hash, meta
         FROM audit_log ORDER BY id DESC LIMIT 100`,
      ),
    ]);

    return Response.json({
      configured: true,
      flags,
      alerts: alerts.map((a) => ({ ...a, meta: parseMeta(a.meta) })),
      dnc: {
        ...freshness,
        internalCount: internalRow ? Number(internalRow.n) : 0,
        nationalCount: nationalRow ? Number(nationalRow.n) : 0,
      },
      suppressions,
      revocations,
      recentCalls: recentCalls.map((c) => ({
        ...c,
        business_name: String(c.business_name ?? ""),
        disclosure_played: Number(c.disclosure_played ?? 0) === 1,
        disclosure_verified: Number(c.disclosure_verified ?? 0) === 1,
      })),
      providerHealth: {
        db: true,
        vapi: vapiConfigured(),
        twilio: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
        resend: Boolean(process.env.RESEND_API_KEY),
        posthog: Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
        dncSan: Boolean(process.env.DNC_SAN),
      },
      auditTail: auditTail.map((a) => ({ ...a, meta: parseMeta(a.meta) })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Compliance query failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
