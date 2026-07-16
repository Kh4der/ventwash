/**
 * discover_osm job — Overpass sweep → leads at status 'discovered' (spec §7).
 * Gated on the 'discovery' channel flag. Every NEWLY created lead fans out
 * crawl_site + lookup_line_type immediately and score_lead at T+10min (so
 * the crawl usually lands first); dedupe re-runs are no-ops via createLead's
 * dedupe key and the jobs' idempotency keys. Counts are surfaced as an
 * 'info' admin alert per run.
 */

import type { Job } from "@/lib/jobs";
import type { HandlerResult } from "@/lib/job-handlers";
import { enqueue } from "@/lib/jobs";
import { createLead } from "@/lib/leads";
import { isChannelEnabled } from "@/lib/flags";
import { raiseAlert } from "@/lib/compliance/audit";
import { fetchOsmBusinesses } from "@/lib/discovery/overpass";

export async function run(job: Job): Promise<HandlerResult> {
  void job;
  if (!(await isChannelEnabled("discovery"))) return { blocked: "channel_disabled" };

  const bboxUnset = !process.env.DISCOVERY_BBOX?.trim();
  const businesses = await fetchOsmBusinesses(); // throws on 429/504 ⇒ backoff

  let created = 0;
  let existing = 0;
  let tombstoned = 0;
  let errored = 0;

  for (const biz of businesses) {
    let result;
    try {
      result = await createLead({
        discoverySource: "osm",
        businessName: biz.name,
        phone: biz.phone,
        website: biz.website,
        cuisine: biz.cuisine,
        address: biz.address,
        city: biz.city,
        region: biz.region,
        postal: biz.postal,
        lat: biz.lat,
        lng: biz.lng,
        osmId: biz.osmId,
        notes: biz.amenity ? `OSM amenity: ${biz.amenity}` : "",
      });
    } catch (err) {
      // One bad element must not sink the whole sweep.
      errored++;
      console.error(`[discover-osm] createLead failed for ${biz.osmId}:`, err);
      continue;
    }
    if (!result) break; // DB unavailable — nothing durable can be written
    if (result.blocked) {
      tombstoned++; // privacy-deleted contact: never re-created
      continue;
    }
    if (!result.created) {
      existing++;
      continue;
    }
    created++;

    const leadId = result.id;
    await enqueue({
      type: "crawl_site",
      leadId,
      payload: { leadId },
      idempotencyKey: `crawl:${leadId}`,
    });
    await enqueue({
      type: "lookup_line_type",
      leadId,
      payload: { leadId },
      idempotencyKey: `lookup:${leadId}`,
    });
    await enqueue({
      type: "score_lead",
      leadId,
      payload: { leadId },
      idempotencyKey: `score:${leadId}:initial`,
      runAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
  }

  await raiseAlert(
    "info",
    "discovery_run",
    `OSM sweep: ${businesses.length} businesses fetched, ${created} leads created, ` +
      `${existing} already known, ${tombstoned} tombstoned` +
      (errored ? `, ${errored} errors` : "") +
      (bboxUnset ? " (DISCOVERY_BBOX unset — simulated)" : ""),
    { fetched: businesses.length, created, existing, tombstoned, errored, simulated: bboxUnset },
  );

  return { simulated: bboxUnset };
}
