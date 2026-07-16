import { randomBytes } from "node:crypto";
import { getDb, qOne, q, nowIso } from "@/lib/db";
import { sha256 } from "@/lib/compliance/audit";
import { enqueue, cancelByKeyPrefix } from "@/lib/jobs";
import { transition, recordLeadEvent } from "@/lib/lead-machine";
import { createAppointment, getAvailableSlots } from "@/lib/appointments";
import { siteBaseUrl } from "@/lib/link-tokens";

/**
 * Onboarding flow: won lead → token-linked intake form → confirmation email →
 * auto-drafted inspection appointment (tentative; the founder one-click
 * confirms, which fans out reminders and advances the lead).
 *
 * Tokens are 128-bit random values; only the sha256 hash is stored. Links
 * expire after TOKEN_TTL_DAYS. Nudge jobs at T+3d and T+7d re-invite
 * non-submitters and no-op once the form is in.
 */

const TOKEN_TTL_DAYS = 30;

export interface OnboardingIssue {
  formId: string;
  token: string;
  url: string;
}

export async function issueOnboardingForm(leadId: string, actor: string): Promise<OnboardingIssue | null> {
  const db = await getDb();
  if (!db) return null;
  const token = randomBytes(16).toString("base64url");
  const tokenHash = sha256(token);
  const now = nowIso();
  const formId = crypto.randomUUID();

  await db.execute({
    sql: `INSERT INTO onboarding_forms (id, lead_id, token_hash, status, sent_at)
          VALUES (?, ?, ?, 'sent', ?)
          ON CONFLICT(lead_id) DO UPDATE SET
            token_hash = excluded.token_hash,
            status = CASE WHEN onboarding_forms.status = 'submitted' THEN 'submitted' ELSE 'sent' END,
            sent_at = excluded.sent_at`,
    args: [formId, leadId, tokenHash, now],
  });

  const url = `${siteBaseUrl()}/onboard/${token}`;
  const ver = tokenHash.slice(0, 8);

  // Re-issuing rotates the token, so any invite/nudge jobs still queued from a
  // previous issuance now carry a dead link. Cancel them, then enqueue fresh
  // jobs whose idempotency keys are versioned by the new token so they are not
  // deduped away against the cancelled ones.
  await cancelByKeyPrefix(`onboard:${leadId}:`);

  await enqueue({
    type: "send_email",
    payload: { template: "onboarding_invite", leadId, onboardingUrl: url },
    leadId,
    idempotencyKey: `onboard:${leadId}:invite:${ver}`,
  });
  await enqueue({
    type: "onboarding_nudge",
    payload: { leadId, onboardingUrl: url, nudge: 1 },
    leadId,
    runAt: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
    idempotencyKey: `onboard:${leadId}:nudge1:${ver}`,
  });
  await enqueue({
    type: "onboarding_nudge",
    payload: { leadId, onboardingUrl: url, nudge: 2 },
    leadId,
    runAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    idempotencyKey: `onboard:${leadId}:nudge2:${ver}`,
  });

  await recordLeadEvent(leadId, "note", actor, { note: "onboarding invite issued" });
  return { formId, token, url };
}

export interface OnboardingForm {
  id: string;
  lead_id: string;
  status: "sent" | "opened" | "submitted" | "expired";
  data: Record<string, unknown> | null;
  sent_at: string;
}

export async function getFormByToken(rawToken: string): Promise<OnboardingForm | null> {
  if (!rawToken || rawToken.length > 64) return null;
  const row = await qOne({
    sql: "SELECT * FROM onboarding_forms WHERE token_hash = ?",
    args: [sha256(rawToken)],
  });
  if (!row) return null;
  const sentAt = new Date(String(row.sent_at)).getTime();
  const expired = Date.now() - sentAt > TOKEN_TTL_DAYS * 24 * 3600_000;
  const status = String(row.status) as OnboardingForm["status"];
  let data: Record<string, unknown> | null = null;
  try {
    data = row.data ? JSON.parse(String(row.data)) : null;
  } catch {
    data = null;
  }
  return {
    id: String(row.id),
    lead_id: String(row.lead_id),
    status: expired && status !== "submitted" ? "expired" : status,
    data,
    sent_at: String(row.sent_at),
  };
}

export async function markFormOpened(formId: string): Promise<void> {
  await q({
    sql: `UPDATE onboarding_forms SET status = 'opened', opened_at = ?
          WHERE id = ? AND status = 'sent'`,
    args: [nowIso(), formId],
  });
}

/** Whitelisted intake fields (NFPA 96-relevant). Everything else is dropped. */
const FORM_FIELDS = [
  "contact_name", "contact_phone", "contact_email", "business_address",
  "hood_count", "hood_locations", "fuel_types", "cooking_volume",
  "roof_access", "operating_hours", "coi_required", "service_frequency",
  "preferred_days", "preferred_time", "notes",
] as const;

export function sanitizeOnboardingData(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of FORM_FIELDS) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, 2000);
  }
  return out;
}

/**
 * Submit the form: persist data, advance the lead, queue the confirmation
 * email + founder notification, and draft the tentative inspection visit.
 */
export async function submitOnboarding(
  rawToken: string,
  input: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const form = await getFormByToken(rawToken);
  if (!form) return { ok: false, error: "Invalid or unknown onboarding link." };
  if (form.status === "expired") return { ok: false, error: "This onboarding link has expired — ask us for a new one." };
  if (form.status === "submitted") return { ok: true }; // idempotent re-submit

  const data = sanitizeOnboardingData(input);
  const now = nowIso();
  // Atomic guard against a double-submit (double-click / retry): the WHERE
  // clause lets exactly one writer flip 'submitted'. If we didn't, another
  // request already ran the side effects (email, inspection draft) — bail.
  const db = await getDb();
  if (!db) return { ok: false, error: "Database not available." };
  const claim = await db.execute({
    sql: `UPDATE onboarding_forms SET status = 'submitted', data = ?, submitted_at = ?
          WHERE id = ? AND status != 'submitted'`,
    args: [JSON.stringify(data), now, form.id],
  });
  if (claim.rowsAffected === 0) return { ok: true }; // someone else won the race

  try {
    await transition(form.lead_id, "onboarded", "customer", { formId: form.id });
  } catch {
    await recordLeadEvent(form.lead_id, "note", "system", {
      note: "onboarding submitted outside won_pending_onboarding state",
    });
  }

  await enqueue({
    type: "send_email",
    payload: { template: "onboarding_confirm", leadId: form.lead_id },
    leadId: form.lead_id,
    idempotencyKey: `onboard:${form.lead_id}:confirm`,
  });
  await enqueue({
    type: "send_email",
    payload: { template: "founder_onboarding_notify", leadId: form.lead_id },
    leadId: form.lead_id,
    idempotencyKey: `onboard:${form.lead_id}:founder_notify`,
  });

  // Draft the inspection: first available slot ≥ 5 business-ish days out.
  const slots = await getAvailableSlots(21);
  const target = slots.find((s) => new Date(s.startsAt).getTime() > Date.now() + 5 * 24 * 3600_000) ?? slots[0];
  if (target) {
    await createAppointment({
      leadId: form.lead_id,
      kind: "inspection",
      startsAt: target.startsAt,
      endsAt: target.endsAt,
      createdBy: "system",
      status: "tentative",
      skipReminders: true, // reminders fan out when the founder confirms
      notes:
        "Auto-drafted from onboarding submission." +
        (data.preferred_days ? ` Preferred days: ${data.preferred_days}.` : "") +
        (data.preferred_time ? ` Preferred time: ${data.preferred_time}.` : ""),
    });
  }

  return { ok: true };
}
