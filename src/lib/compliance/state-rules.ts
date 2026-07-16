/**
 * Per-state telemarketing rule table — versioned in git so counsel can review
 * a diff, not a database. The quiet-hours gate applies the STRICTEST of the
 * federal window (8:00–21:00 recipient-local) and the state row.
 *
 * RULES_VERSION is stamped into call audit metadata so every dial records
 * which rule set it was checked against.
 *
 * NOTE FOR COUNSEL REVIEW: values below reflect commonly cited state
 * mini-TCPA provisions as of early 2026 (FL SB 1120, OK mini-TCPA, WA
 * commercial telephone solicitation, MD Stop the Spam Calls Act, CT
 * telemarketing rules). Verify before enabling any outbound voice channel —
 * this table is a launch-gate review item, not legal advice.
 */

export const RULES_VERSION = "2026-07-15.1";

export interface StateRule {
  /** Local-time hour bounds (inclusive start, exclusive end). */
  startHour: number;
  endHour: number;
  /** Max contact attempts to one person per 24h across channels. */
  maxAttemptsPer24h: number;
}

/** Federal TCPA baseline: 8am–9pm recipient local. */
export const FEDERAL_RULE: StateRule = {
  startHour: 8,
  endHour: 21,
  maxAttemptsPer24h: 3,
};

export const STATE_RULES: Record<string, StateRule> = {
  // Florida: 8am–8pm, max 3 attempts per 24h on the same subject matter.
  FL: { startHour: 8, endHour: 20, maxAttemptsPer24h: 3 },
  // Oklahoma mini-TCPA mirrors Florida's structure.
  OK: { startHour: 8, endHour: 20, maxAttemptsPer24h: 3 },
  // Washington: solicitation window 8am–8pm.
  WA: { startHour: 8, endHour: 20, maxAttemptsPer24h: 3 },
  // Maryland: conservative posture under Stop the Spam Calls Act.
  MD: { startHour: 8, endHour: 20, maxAttemptsPer24h: 3 },
  // Connecticut: 9am–8pm solicitation window.
  CT: { startHour: 9, endHour: 20, maxAttemptsPer24h: 3 },
};

/** Strictest applicable rule for a lead's state (undefined region → federal). */
export function ruleForRegion(region: string | null | undefined): StateRule {
  const state = (region ?? "").trim().toUpperCase();
  const stateRule = STATE_RULES[state];
  if (!stateRule) return FEDERAL_RULE;
  return {
    startHour: Math.max(FEDERAL_RULE.startHour, stateRule.startHour),
    endHour: Math.min(FEDERAL_RULE.endHour, stateRule.endHour),
    maxAttemptsPer24h: Math.min(FEDERAL_RULE.maxAttemptsPer24h, stateRule.maxAttemptsPer24h),
  };
}
