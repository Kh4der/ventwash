/**
 * score_lead job — recomputes a lead's score from its row + provenanced
 * contact_points, persists it, and promotes discovered/enriched leads at or
 * above REVIEW_THRESHOLD into review_queue for the human-in-the-loop
 * approval gate (spec §7). Scoring is ranking only; it never bypasses any
 * compliance check.
 */

import type { Job } from "@/lib/jobs";
import type { HandlerResult } from "@/lib/job-handlers";
import { q, nowIso } from "@/lib/db";
import { getLead } from "@/lib/leads";
import { transition, IllegalTransitionError } from "@/lib/lead-machine";
import { scoreLead, REVIEW_THRESHOLD } from "@/lib/discovery/score";

export async function run(job: Job): Promise<HandlerResult> {
  const leadId = String(job.payload.leadId ?? job.lead_id ?? "");
  if (!leadId) throw new Error("score_lead: missing leadId in payload");
  const lead = await getLead(leadId);
  if (!lead) return; // deleted/unknown lead — nothing to score

  const contactPoints = (
    await q({ sql: "SELECT kind, value FROM contact_points WHERE lead_id = ?", args: [leadId] })
  ).map((row) => ({ kind: String(row.kind), value: String(row.value) }));

  const str = (v: unknown): string | null => (v == null ? null : String(v));
  const score = scoreLead(
    {
      cuisine: str(lead.cuisine),
      notes: str(lead.notes),
      phone_e164: str(lead.phone_e164),
      email: str(lead.email),
      website: str(lead.website),
      address: str(lead.address),
      city: str(lead.city),
      region: str(lead.region),
      postal: str(lead.postal),
    },
    contactPoints,
  );

  await q({
    sql: "UPDATE leads SET score = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    args: [score, nowIso(), leadId],
  });

  const status = String(lead.status);
  if (score >= REVIEW_THRESHOLD && (status === "discovered" || status === "enriched")) {
    try {
      await transition(leadId, "review_queue", "system", { score });
    } catch (err) {
      // Lead moved concurrently (e.g. inbound call made it 'engaged') — fine.
      if (!(err instanceof IllegalTransitionError)) throw err;
    }
  }
}
