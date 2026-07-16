/**
 * Lead scoring — orders the founder review queue by grease-load likelihood
 * and contactability. Pure function; the score_lead job persists the result
 * and promotes discovered/enriched leads at REVIEW_THRESHOLD into
 * review_queue (spec §7). Scores are advisory ranking only — they never gate
 * compliance (consent/DNC/quiet-hours run at send time regardless).
 */

/** Score at (and above) which a lead enters the founder review queue. */
export const REVIEW_THRESHOLD = 40;

/**
 * Fryer-heavy cuisines (OSM `cuisine` tag values) — the kitchens whose hood
 * and duct grease load makes NFPA 96 cleaning an easy conversation.
 */
const FRYER_HEAVY_CUISINES = [
  "burger",
  "fried_chicken",
  "chicken",
  "fried",
  "fish_and_chips",
  "chinese",
  "mexican",
  "tex-mex",
  "pizza",
  "bbq",
  "barbecue",
  "wings",
  "seafood",
  "steak",
  "american",
  "diner",
  "donut",
  "doughnut",
  "breakfast",
  "thai",
  "korean",
  "indian",
];

export interface ScorableLead {
  cuisine?: string | null;
  /** Free-text notes; discover_osm records "OSM amenity: …" here. */
  notes?: string | null;
  phone_e164?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  postal?: string | null;
}

export interface ScorableContactPoint {
  kind: string; // 'email' | 'phone'
  value: string;
}

/**
 * +30 hood-relevant cuisine/amenity (fryer-heavy cuisine, or fast_food which
 * is fryer-heavy by definition), +25 phone, +20 email, +15 website,
 * +10 full address. Max 100.
 */
export function scoreLead(lead: ScorableLead, contactPoints: ScorableContactPoint[]): number {
  let score = 0;

  const cuisine = (lead.cuisine ?? "").toLowerCase();
  const notes = (lead.notes ?? "").toLowerCase();
  const fryerHeavy =
    FRYER_HEAVY_CUISINES.some((c) => cuisine.includes(c)) || notes.includes("fast_food");
  if (fryerHeavy) score += 30;

  const hasPhone = Boolean(lead.phone_e164) || contactPoints.some((c) => c.kind === "phone");
  const hasEmail = Boolean(lead.email) || contactPoints.some((c) => c.kind === "email");
  if (hasPhone) score += 25;
  if (hasEmail) score += 20;
  if (lead.website) score += 15;
  if (lead.address && lead.city && (lead.postal || lead.region)) score += 10;

  return score;
}
