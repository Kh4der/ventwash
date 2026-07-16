/**
 * Overpass (OpenStreetMap) discovery client — the only business-directory
 * source this repo is allowed to query (docs/automation-platform-spec.md D7;
 * Google Places / Yelp clients are architecturally banned). Polite by
 * construction: a single concurrent request, an honest User-Agent that links
 * to /bot, and Retry-After honored by THROWING so the jobs outbox backs off
 * instead of hammering the endpoint. ODbL attribution ("Business locations
 * © OpenStreetMap contributors") renders wherever OSM-sourced leads appear.
 */

const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";
const DEFAULT_UA = "VentWashLeadBot/1.0 (+https://ventwash.example/bot)";
const AMENITY_FILTER = 'amenity~"restaurant|fast_food|cafe|bar"';

export interface OsmBusiness {
  /** `${type}/${id}`, e.g. "node/123456" or "way/987654". */
  osmId: string;
  name: string;
  amenity?: string;
  phone?: string;
  website?: string;
  cuisine?: string;
  /** "housenumber street" from addr:* tags, when present. */
  address?: string;
  city?: string;
  region?: string;
  postal?: string;
  lat?: number;
  lng?: number;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

export function crawlerUserAgent(): string {
  return process.env.CRAWLER_USER_AGENT || DEFAULT_UA;
}

/** Parse + validate DISCOVERY_BBOX ("south,west,north,east" — 4 floats). */
export function parseBbox(raw: string): [number, number, number, number] {
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`DISCOVERY_BBOX must be "south,west,north,east" (4 floats); got "${raw}"`);
  }
  const [south, west, north, east] = parts;
  if (south < -90 || north > 90 || south >= north || west < -180 || east > 180 || west >= east) {
    throw new Error(`DISCOVERY_BBOX out of range (south<north, west<east required); got "${raw}"`);
  }
  return [south, west, north, east];
}

/** Overpass QL for hood-relevant amenities inside the bbox (nodes + ways, capped). */
export function buildOverpassQuery(bbox: [number, number, number, number]): string {
  const b = bbox.join(",");
  return `[out:json][timeout:25];(node[${AMENITY_FILTER}](${b});way[${AMENITY_FILTER}](${b}););out tags center 500;`;
}

// Single-concurrency lock: only one Overpass request may be in flight at a
// time, even if overlapping cron ticks run discovery jobs concurrently.
let inflight: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = inflight.then(fn, fn);
  inflight = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Fetch hood-relevant businesses from Overpass for DISCOVERY_BBOX.
 * Unset bbox ⇒ [] (dev no-op). 429/504 ⇒ throw so the job retries with
 * backoff (we never sit in-process waiting out a Retry-After).
 */
export async function fetchOsmBusinesses(): Promise<OsmBusiness[]> {
  const rawBbox = process.env.DISCOVERY_BBOX?.trim();
  if (!rawBbox) {
    console.log("[dev no-op] discover_osm: DISCOVERY_BBOX unset — skipping Overpass sweep.");
    return [];
  }
  const query = buildOverpassQuery(parseBbox(rawBbox));
  const endpoint = process.env.OVERPASS_API_URL || DEFAULT_ENDPOINT;

  const res = await withLock(() =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": crawlerUserAgent(),
      },
      body: "data=" + encodeURIComponent(query),
      signal: AbortSignal.timeout(30_000),
    }),
  );

  if (res.status === 429 || res.status === 504) {
    const retryAfter = res.headers.get("Retry-After");
    throw new Error(
      `Overpass rate limit: HTTP ${res.status}` +
        (retryAfter ? ` (Retry-After: ${retryAfter}s)` : "") +
        " — job will back off",
    );
  }
  if (!res.ok) throw new Error(`Overpass request failed: HTTP ${res.status}`);

  const data = (await res.json()) as { elements?: OverpassElement[] };
  const out: OsmBusiness[] = [];
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const name = (tags.name ?? "").trim();
    if (!name) continue; // unnamed elements are unusable as leads
    const lat = el.type === "node" ? el.lat : el.center?.lat;
    const lng = el.type === "node" ? el.lon : el.center?.lon;
    const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
    out.push({
      osmId: `${el.type}/${el.id}`,
      name,
      amenity: tags.amenity || undefined,
      phone: tags.phone ?? tags["contact:phone"],
      website: tags.website ?? tags["contact:website"],
      cuisine: tags.cuisine || undefined,
      address: street || undefined,
      city: tags["addr:city"] || undefined,
      region: tags["addr:state"] || undefined,
      postal: tags["addr:postcode"] || undefined,
      lat: typeof lat === "number" ? lat : undefined,
      lng: typeof lng === "number" ? lng : undefined,
    });
  }
  return out;
}
