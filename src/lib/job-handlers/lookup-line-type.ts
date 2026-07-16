/**
 * lookup_line_type job — Twilio Lookup v2 line_type_intelligence, the
 * compliance keystone for the wireless gate (D19): line type is stored with
 * line_type_checked_at at lead creation/import time and re-checked by
 * callers when >90 days old. Unconfigured Twilio stores 'unknown', which
 * FAILS CLOSED downstream — canPlaceAiCall/canPlaceBridgeCall refuse
 * unknown line types. Also backfills leads.timezone (quiet-hours gate needs
 * it; NULL timezone blocks all contact).
 */

import type { Job } from "@/lib/jobs";
import type { HandlerResult } from "@/lib/job-handlers";
import { q, nowIso } from "@/lib/db";
import { getLead } from "@/lib/leads";
import { resolveTimezone } from "@/lib/compliance/tz";

const KNOWN_LINE_TYPES = new Set(["landline", "mobile", "fixedVoip", "nonFixedVoip", "tollFree"]);

export async function run(job: Job): Promise<HandlerResult> {
  const leadId = String(job.payload.leadId ?? job.lead_id ?? "");
  if (!leadId) throw new Error("lookup_line_type: missing leadId in payload");
  const lead = await getLead(leadId);
  if (!lead) return; // deleted/unknown lead
  const phone = lead.phone_e164 ? String(lead.phone_e164) : "";
  if (!phone) return; // nothing to look up

  // Timezone backfill (fail-closed quiet hours need it; creation may have
  // lacked postal/region/phone at the time).
  let tzSet = "";
  const tzArgs: string[] = [];
  if (!lead.timezone) {
    const tz = resolveTimezone({
      postal: lead.postal ? String(lead.postal) : null,
      region: lead.region ? String(lead.region) : null,
      phone_e164: phone,
    });
    if (tz) {
      tzSet = ", timezone = ?";
      tzArgs.push(tz);
    }
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const now = nowIso();

  if (!sid || !token) {
    await q({
      sql: `UPDATE leads SET phone_line_type = 'unknown', line_type_checked_at = ?${tzSet}, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL`,
      args: [now, ...tzArgs, now, leadId],
    });
    console.log(
      "[dev no-op] lookup_line_type: Twilio unconfigured — stored 'unknown' (fails closed downstream).",
    );
    return { simulated: true };
  }

  const res = await fetch(
    `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phone)}?Fields=line_type_intelligence`,
    {
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    throw new Error(`Twilio Lookup failed for lead ${leadId}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    line_type_intelligence?: { type?: string | null } | null;
  };
  const rawType = data.line_type_intelligence?.type ?? "unknown";
  const lineType = KNOWN_LINE_TYPES.has(rawType) ? rawType : "unknown";

  await q({
    sql: `UPDATE leads SET phone_line_type = ?, line_type_checked_at = ?${tzSet}, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
    args: [lineType, now, ...tzArgs, now, leadId],
  });
}
