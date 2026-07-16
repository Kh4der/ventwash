import { localTime, isValidTimezone } from "@/lib/compliance/tz";
import { ruleForRegion, RULES_VERSION } from "@/lib/compliance/state-rules";

/**
 * Recipient-local contact window check. FAIL CLOSED:
 * unknown timezone → blocked ('tz_unknown'), never "assume business hours".
 * Used by every outbound voice and SMS path.
 */

export interface QuietHoursDecision {
  allowed: boolean;
  reason?: "tz_unknown" | "outside_window";
  /** Rule actually applied, for audit metadata. */
  window: { startHour: number; endHour: number; rulesVersion: string };
  localHour?: number;
}

export function checkQuietHours(
  lead: { timezone?: string | null; region?: string | null },
  at: Date = new Date(),
): QuietHoursDecision {
  const rule = ruleForRegion(lead.region);
  const window = {
    startHour: rule.startHour,
    endHour: rule.endHour,
    rulesVersion: RULES_VERSION,
  };

  const tz = (lead.timezone ?? "").trim();
  if (!tz || !isValidTimezone(tz)) {
    return { allowed: false, reason: "tz_unknown", window };
  }

  const { hour } = localTime(tz, at);
  if (Number.isNaN(hour)) return { allowed: false, reason: "tz_unknown", window };

  if (hour < rule.startHour || hour >= rule.endHour) {
    return { allowed: false, reason: "outside_window", window, localHour: hour };
  }
  return { allowed: true, window, localHour: hour };
}

/** Attempt-frequency cap from the same rule table. */
export function maxAttemptsPer24h(region: string | null | undefined): number {
  return ruleForRegion(region).maxAttemptsPer24h;
}
