/**
 * crawl_site job — orchestrates the polite crawler for one lead's website,
 * persists provenanced contact_points rows (the "where did you get my
 * email?" answer, required before any cold send — D9), backfills the lead's
 * email/phone/timezone from the best find, and promotes discovered →
 * enriched. Gated on the 'crawler' channel flag; the crawler itself owns
 * robots.txt, the permanent-deny ledger, and crawl_log.
 */

import type { Job } from "@/lib/jobs";
import type { HandlerResult } from "@/lib/job-handlers";
import { enqueue } from "@/lib/jobs";
import { q, nowIso } from "@/lib/db";
import { getLead } from "@/lib/leads";
import { isChannelEnabled } from "@/lib/flags";
import { transition, recordLeadEvent, IllegalTransitionError } from "@/lib/lead-machine";
import { resolveTimezone } from "@/lib/compliance/tz";
import { crawlLeadSite } from "@/lib/discovery/crawler";

export async function run(job: Job): Promise<HandlerResult> {
  if (!(await isChannelEnabled("crawler"))) return { blocked: "channel_disabled" };

  const leadId = String(job.payload.leadId ?? job.lead_id ?? "");
  if (!leadId) throw new Error("crawl_site: missing leadId in payload");
  const lead = await getLead(leadId);
  if (!lead) return; // deleted/unknown lead — nothing to crawl
  const website = lead.website ? String(lead.website) : "";
  if (!website) return; // no website — done

  // Denied domains short-circuit inside the crawler (crawl_domains.denied).
  const result = await crawlLeadSite(website);

  const now = nowIso();
  for (const email of result.emails) {
    await q({
      sql: `INSERT OR IGNORE INTO contact_points (lead_id, kind, value, source_url, extracted_at)
            VALUES (?, 'email', ?, ?, ?)`,
      args: [leadId, email.value, email.sourceUrl, now],
    });
  }
  for (const phone of result.phones) {
    await q({
      sql: `INSERT OR IGNORE INTO contact_points (lead_id, kind, value, source_url, extracted_at)
            VALUES (?, 'phone', ?, ?, ?)`,
      args: [leadId, phone.value, phone.sourceUrl, now],
    });
  }

  // Backfill lead contact fields from the best (first-found) contact point.
  const bestEmail = result.emails[0]?.value ?? null;
  const bestPhone = result.phones[0]?.value ?? null; // already E.164
  const sets: string[] = [];
  const args: string[] = [];
  if (!lead.email && bestEmail) {
    sets.push("email = ?");
    args.push(bestEmail);
  }
  if (!lead.phone_e164 && bestPhone) {
    sets.push("phone_e164 = ?");
    args.push(bestPhone);
  }
  if (!lead.timezone) {
    const tz = resolveTimezone({
      postal: lead.postal ? String(lead.postal) : null,
      region: lead.region ? String(lead.region) : null,
      phone_e164: lead.phone_e164 ? String(lead.phone_e164) : bestPhone,
    });
    if (tz) {
      sets.push("timezone = ?");
      args.push(tz);
    }
  }
  if (sets.length > 0) {
    await q({
      sql: `UPDATE leads SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      args: [...args, now, leadId],
    });
  }

  // Contact points found ⇒ discovered → enriched. Leads that already moved
  // on (engaged, review_queue, …) simply stay where they are.
  if (result.emails.length + result.phones.length > 0) {
    try {
      await transition(leadId, "enriched", "system", { via: "crawl_site" });
    } catch (err) {
      if (!(err instanceof IllegalTransitionError)) throw err;
    }
  }

  await recordLeadEvent(leadId, "crawl", "system", {
    pages_fetched: result.pagesFetched,
    emails_found: result.emails.length,
    phones_found: result.phones.length,
    denied: result.denied,
  });

  await enqueue({
    type: "score_lead",
    leadId,
    payload: { leadId },
    idempotencyKey: `score:${leadId}:post-crawl`,
  });
}
