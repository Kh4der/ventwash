import { qOne } from "@/lib/db";
import { getDb } from "@/lib/db";
import { isChannelEnabled } from "@/lib/flags";
import { isRevoked, latestConsentEvent } from "@/lib/compliance/consent";
import { isInternalDnc, isNationalDnc, dncFreshness } from "@/lib/compliance/dnc";
import { checkQuietHours, maxAttemptsPer24h } from "@/lib/compliance/quiet-hours";
import { RULES_VERSION } from "@/lib/compliance/state-rules";
import { writeAudit } from "@/lib/compliance/audit";
import { captureServerEvent } from "@/lib/posthog-server";

/**
 * THE voice choke points. Every AI dial goes through canPlaceAiCall and every
 * founder click-to-dial bridge goes through canPlaceBridgeCall. There are no
 * other code paths that place outbound calls, and neither function has an
 * override parameter — by design (docs/automation-platform-spec.md §10).
 *
 * FCC (Feb 2024): AI-generated voices are "artificial or prerecorded" under
 * TCPA §227. Consequences implemented here:
 *  - consent_tier 'none' can NEVER receive an AI call. No admin flag, no
 *    approval click, no env var reaches around this.
 *  - 'express' permits informational calls related to the lead's own inquiry
 *    (quote_followup within 90 days; confirmation of a booked appointment).
 *  - 'express_written' additionally permits marketing calls, still subject to
 *    fresh national-DNC data.
 * Every check fails CLOSED: unknown line type, unknown timezone, stale DNC
 * data, missing DB — no call.
 */

export type CallPurpose = "quote_followup" | "appointment_confirmation" | "marketing" | "cold_intro";

export interface LeadForCall {
  id: string;
  phone_e164: string | null;
  consent_tier: string;
  approval: string;
  phone_line_type: string | null;
  line_type_checked_at: string | null;
  timezone: string | null;
  region: string | null;
  status: string;
  voicemail_count: number;
}

export interface CallDecision {
  allowed: boolean;
  reason?: string;
  /** DNC exception basis snapshotted onto the call row. */
  basis?: "inquiry_ebr" | "express_written" | null;
  meta: Record<string, unknown>;
}

const LINE_TYPE_MAX_AGE_DAYS = 90;
const INQUIRY_EBR_DAYS = 90;

function lineTypeFresh(lead: LeadForCall): boolean {
  if (!lead.phone_line_type || lead.phone_line_type === "unknown") return false;
  if (!lead.line_type_checked_at) return false;
  const age = Date.now() - new Date(lead.line_type_checked_at).getTime();
  return age <= LINE_TYPE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

async function attemptsInLast24h(leadId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = await qOne({
    sql: `SELECT COUNT(*) AS n FROM call_attempts
          WHERE lead_id = ? AND direction = 'outbound' AND created_at >= ?`,
    args: [leadId, since],
  });
  return row ? Number(row.n) : 0;
}

async function blocked(
  kind: "ai" | "bridge",
  lead: LeadForCall,
  purpose: string,
  reason: string,
  meta: Record<string, unknown> = {},
): Promise<CallDecision> {
  await writeAudit({
    actor: "system",
    action: "call_blocked",
    leadId: lead.id,
    channel: kind === "ai" ? "voice_ai" : "voice_bridge",
    consentTier: lead.consent_tier,
    meta: { reason, purpose, rulesVersion: RULES_VERSION, ...meta },
  });
  await captureServerEvent("call_blocked_compliance", {
    lead_id: lead.id,
    mode: kind,
    purpose,
    reason,
  });
  return { allowed: false, reason, meta: { rulesVersion: RULES_VERSION, ...meta } };
}

/**
 * Gate for every AI (Vapi) outbound dial. Sequential and fail-closed; the
 * first failing check refuses the call and writes the audit row.
 */
export async function canPlaceAiCall(
  lead: LeadForCall,
  purpose: CallPurpose,
  context: { appointmentId?: string } = {},
): Promise<CallDecision> {
  // 0. Durable DB — without it nothing dials (also: flags read as off).
  if (!(await getDb())) {
    return { allowed: false, reason: "db_unconfigured", meta: {} };
  }

  // 1. Kill switch.
  if (!(await isChannelEnabled("voice_outbound_ai"))) {
    return blocked("ai", lead, purpose, "channel_disabled");
  }

  // 2. A phone number must exist.
  if (!lead.phone_e164) return blocked("ai", lead, purpose, "no_phone");

  // 3. Lead status: never dial a do-not-contact or deleted lead.
  if (lead.status === "do_not_contact") {
    return blocked("ai", lead, purpose, "do_not_contact_status");
  }

  // 4. Revocations override everything.
  if (await isRevoked({ id: lead.id, phone_e164: lead.phone_e164 }, "voice")) {
    return blocked("ai", lead, purpose, "revoked");
  }

  // 5. Internal DNC is honored indefinitely.
  if (await isInternalDnc(lead.phone_e164)) {
    return blocked("ai", lead, purpose, "dnc_internal");
  }

  // 6. Consent matrix. Tier 'none' has NO path here — this is the hard block.
  const tier = lead.consent_tier;
  if (tier !== "express" && tier !== "express_written") {
    return blocked("ai", lead, purpose, "no_consent_tier");
  }
  if (purpose === "cold_intro") {
    // Cold intros are structurally human-bridge-only; an AI cold intro is
    // not a thing this system can do, even for written-consent leads.
    return blocked("ai", lead, purpose, "cold_intro_is_bridge_only");
  }

  let basis: "inquiry_ebr" | "express_written";
  if (tier === "express_written") {
    basis = "express_written";
  } else {
    // tier === 'express'
    if (purpose === "marketing") {
      return blocked("ai", lead, purpose, "marketing_requires_written_consent");
    }
    if (purpose === "quote_followup") {
      const evt = await latestConsentEvent(lead.id, INQUIRY_EBR_DAYS);
      if (!evt) return blocked("ai", lead, purpose, "inquiry_older_than_90d");
    } else if (purpose === "appointment_confirmation") {
      const appt = context.appointmentId
        ? await qOne({
            sql: `SELECT id FROM appointments WHERE id = ? AND lead_id = ?
                    AND status IN ('tentative','confirmed','rescheduled')`,
            args: [context.appointmentId, lead.id],
          })
        : await qOne({
            sql: `SELECT id FROM appointments WHERE lead_id = ?
                    AND status IN ('tentative','confirmed','rescheduled') LIMIT 1`,
            args: [lead.id],
          });
      if (!appt) return blocked("ai", lead, purpose, "no_active_appointment");
    }
    basis = "inquiry_ebr";
  }

  // 7. Line type must be known and fresh (unset Twilio creds ⇒ 'unknown' ⇒ blocked).
  if (!lineTypeFresh(lead)) {
    return blocked("ai", lead, purpose, "line_type_unknown_or_stale", {
      lineType: lead.phone_line_type,
    });
  }

  // 8. National DNC. Marketing needs a clear number AND fresh registry data;
  //    informational calls proceed on the recorded exception basis.
  if (purpose === "marketing") {
    const fresh = await dncFreshness();
    if (!fresh.fresh) {
      return blocked("ai", lead, purpose, "dnc_registry_stale", { syncedAt: fresh.syncedAt });
    }
    if (await isNationalDnc(lead.phone_e164)) {
      return blocked("ai", lead, purpose, "dnc_national");
    }
  }

  // 9. Recipient-local quiet hours (strictest of federal + state rules).
  const qh = checkQuietHours(lead);
  if (!qh.allowed) {
    return blocked("ai", lead, purpose, "quiet_hours_" + qh.reason, {
      localHour: qh.localHour,
      window: qh.window,
    });
  }

  // 10. Frequency caps.
  const attempts = await attemptsInLast24h(lead.id);
  const cap = maxAttemptsPer24h(lead.region);
  if (attempts >= cap) {
    return blocked("ai", lead, purpose, "frequency_cap", { attempts, cap });
  }
  // One voicemail per campaign for EVERY AI dial (spec §10.1), not just marketing.
  if (lead.voicemail_count >= 1) {
    return blocked("ai", lead, purpose, "voicemail_cap");
  }

  return {
    allowed: true,
    basis,
    meta: { rulesVersion: RULES_VERSION, localHour: qh.localHour },
  };
}

/**
 * Gate for the founder click-to-dial bridge — the ONLY path to a tier-'none'
 * phone. A human speaks on the line; no AI, no prerecorded audio. Restricted
 * to verified business landlines / fixed VoIP, per-lead founder approval, and
 * fresh national-DNC data with the number clear (no SAN subscription ⇒ no
 * cold dialing through the system, period).
 */
export async function canPlaceBridgeCall(lead: LeadForCall): Promise<CallDecision> {
  if (!(await getDb())) {
    return { allowed: false, reason: "db_unconfigured", meta: {} };
  }
  if (!(await isChannelEnabled("voice_outbound_bridge"))) {
    return blocked("bridge", lead, "cold_intro", "channel_disabled");
  }
  if (!lead.phone_e164) return blocked("bridge", lead, "cold_intro", "no_phone");
  if (lead.status === "do_not_contact") {
    return blocked("bridge", lead, "cold_intro", "do_not_contact_status");
  }
  if (await isRevoked({ id: lead.id, phone_e164: lead.phone_e164 }, "voice")) {
    return blocked("bridge", lead, "cold_intro", "revoked");
  }
  if (await isInternalDnc(lead.phone_e164)) {
    return blocked("bridge", lead, "cold_intro", "dnc_internal");
  }

  // Founder approval is a logged legal decision — required for every bridge dial.
  if (lead.approval !== "approved") {
    return blocked("bridge", lead, "cold_intro", "not_approved");
  }

  // Business landline / fixed VoIP only. Wireless and unknown fail closed.
  if (!lineTypeFresh(lead)) {
    return blocked("bridge", lead, "cold_intro", "line_type_unknown_or_stale");
  }
  if (lead.phone_line_type !== "landline" && lead.phone_line_type !== "fixedVoip") {
    return blocked("bridge", lead, "cold_intro", "line_type_not_landline", {
      lineType: lead.phone_line_type,
    });
  }

  // Cold dials require fresh registry data and a clear number — no exceptions.
  const fresh = await dncFreshness();
  if (!fresh.fresh) {
    return blocked("bridge", lead, "cold_intro", "dnc_registry_stale", {
      syncedAt: fresh.syncedAt,
    });
  }
  if (await isNationalDnc(lead.phone_e164)) {
    return blocked("bridge", lead, "cold_intro", "dnc_national");
  }

  const qh = checkQuietHours(lead);
  if (!qh.allowed) {
    return blocked("bridge", lead, "cold_intro", "quiet_hours_" + qh.reason, {
      localHour: qh.localHour,
      window: qh.window,
    });
  }

  const attempts = await attemptsInLast24h(lead.id);
  const cap = maxAttemptsPer24h(lead.region);
  if (attempts >= cap) {
    return blocked("bridge", lead, "cold_intro", "frequency_cap", { attempts, cap });
  }

  return { allowed: true, basis: null, meta: { rulesVersion: RULES_VERSION } };
}
