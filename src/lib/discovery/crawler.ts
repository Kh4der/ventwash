/**
 * Polite site crawler for lead-website contact discovery (spec §10 crawling
 * conduct, D16). Hard guardrails, all fail-closed:
 *  - robots.txt honored (unparseable/empty ⇒ disallow-all); cached 24h in
 *    crawl_domains.
 *  - 1 request per crawl_delay_s per host (sequential, min 3s), 8s timeout
 *    per fetch, ≤10 pages per site, ≤~40s total per job.
 *  - Honest User-Agent linking to /bot.
 *  - HTTP 401/403/429 or a CAPTCHA marker ⇒ crawl_domains.denied=1, STOP
 *    permanently. There is deliberately NO code path for login forms,
 *    paywalls, or CAPTCHA solving.
 *  - EVERY fetch (including robots.txt) is logged to append-only crawl_log.
 * If regex extraction ever proves insufficient for JS-rendered sites, the
 * documented fallback is a config swap to Apify's contact-scraper actor
 * inside the crawl-site handler — not a redesign (D16).
 */

import { q, qOne, nowIso } from "@/lib/db";
import {
  parseRobots,
  isAllowed,
  crawlDelaySeconds,
  ALLOW_ALL,
  type Robots,
} from "@/lib/discovery/robots";
import { extractContacts, type ExtractedContact } from "@/lib/discovery/extract";
import { crawlerUserAgent } from "@/lib/discovery/overpass";

const PAGE_TIMEOUT_MS = 8_000;
const MAX_PAGES = 10;
const TOTAL_BUDGET_MS = 40_000;
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_CHARS = 500_000;
const PRIORITY_PATHS = ["/contact", "/contact-us", "/about", "/about-us", "/locations"];
const CAPTCHA_MARKERS = ["cf-challenge", "recaptcha", "hcaptcha"];
const DENY_STATUSES = new Set([401, 403, 429]);
const SKIP_EXT_RE =
  /\.(pdf|png|jpe?g|gif|webp|svg|ico|css|js|json|xml|zip|gz|mp[34]|mov|avi|docx?|xlsx?|pptx?|woff2?)$/i;
const LINK_KEYWORD_RE = /contact|about|location|visit|find|team|info/i;

export interface CrawlResult {
  emails: ExtractedContact[];
  phones: ExtractedContact[];
  pagesFetched: number;
  /** Non-null when the domain is (or became) permanently denied. */
  denied: string | null;
}

type RobotsDecision = "allowed" | "disallowed" | "no_robots" | "robots_unparseable";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Append-only compliance audit of every fetch (and robots skip decisions). */
async function logCrawl(
  url: string,
  host: string,
  httpStatus: number | null,
  robotsDecision: RobotsDecision,
  outcome: "extracted" | "nothing_found" | "denied" | "error" | "skipped_no_harvest",
): Promise<void> {
  await q({
    sql: `INSERT INTO crawl_log (url, host, fetched_at, http_status, robots_decision, outcome)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [url, host, nowIso(), httpStatus, robotsDecision, outcome],
  });
}

function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

async function fetchWithTimeout(
  url: string,
): Promise<{ status: number; body: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": crawlerUserAgent(),
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = res.headers.get("content-type") ?? "";
    const isText = contentType === "" || /text\/|html|xml|json/i.test(contentType);
    const body = isText ? (await res.text()).slice(0, MAX_BODY_CHARS) : "";
    return { status: res.status, body, finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

interface RobotsState {
  robots: Robots;
  decision: RobotsDecision; // decision recorded for pages we go on to fetch
  fetchedNow: boolean;
}

/** Load robots for the domain — crawl_domains cache first, re-fetch after 24h. */
async function loadRobots(
  domainKey: string,
  origin: string,
  cached: Record<string, unknown> | null,
): Promise<RobotsState> {
  const fetchedAt = cached?.robots_fetched_at ? String(cached.robots_fetched_at) : null;
  const fresh = fetchedAt !== null && Date.now() - Date.parse(fetchedAt) < ROBOTS_TTL_MS;
  if (cached && fresh) {
    if (cached.robots_txt === null || cached.robots_txt === undefined) {
      return { robots: ALLOW_ALL, decision: "no_robots", fetchedNow: false };
    }
    const robots = parseRobots(String(cached.robots_txt));
    return {
      robots,
      decision: robots.disallowAll ? "robots_unparseable" : "allowed",
      fetchedNow: false,
    };
  }

  const robotsUrl = origin + "/robots.txt";
  let robotsTxt: string | null = null; // null ⇒ no robots.txt exists (allow-all)
  let robots: Robots;
  let decision: RobotsDecision;
  try {
    const res = await fetchWithTimeout(robotsUrl);
    if (res.status === 404 || res.status === 410) {
      robots = ALLOW_ALL;
      decision = "no_robots";
      await logCrawl(robotsUrl, domainKey, res.status, "no_robots", "nothing_found");
    } else if (res.status >= 200 && res.status < 300) {
      robotsTxt = res.body;
      robots = parseRobots(robotsTxt);
      decision = robots.disallowAll ? "robots_unparseable" : "allowed";
      await logCrawl(robotsUrl, domainKey, res.status, decision, "extracted");
    } else {
      // Any other status: intent unknowable ⇒ fail closed for the next 24h.
      robotsTxt = "";
      robots = parseRobots("");
      decision = "robots_unparseable";
      await logCrawl(robotsUrl, domainKey, res.status, decision, "error");
    }
  } catch {
    robotsTxt = "";
    robots = parseRobots("");
    decision = "robots_unparseable";
    await logCrawl(robotsUrl, domainKey, null, decision, "error");
  }

  await q({
    sql: `INSERT INTO crawl_domains (domain, robots_txt, robots_fetched_at, crawl_delay_s)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(domain) DO UPDATE SET
            robots_txt = excluded.robots_txt,
            robots_fetched_at = excluded.robots_fetched_at,
            crawl_delay_s = excluded.crawl_delay_s`,
    args: [domainKey, robotsTxt, nowIso(), crawlDelaySeconds(robots)],
  });

  return { robots, decision, fetchedNow: true };
}

/** Same-registrable-domain link discovery from the homepage, contact-ish first. */
function discoverLinks(html: string, base: URL, domainKey: string): string[] {
  const priority: string[] = [];
  const rest: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#\s]+)["']/gi)) {
    let url: URL;
    try {
      url = new URL(m[1], base);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (stripWww(url.hostname) !== domainKey) continue; // same site only
    if (SKIP_EXT_RE.test(url.pathname)) continue;
    url.hash = "";
    const key = url.href;
    if (seen.has(key)) continue;
    seen.add(key);
    (LINK_KEYWORD_RE.test(url.pathname) ? priority : rest).push(key);
  }
  return [...priority, ...rest].slice(0, 15);
}

/**
 * Crawl one lead's website for contact points. Respects the permanent-deny
 * ledger, robots.txt, per-host delay, page cap, and total time budget; stops
 * early and returns whatever it found (the job can be re-run).
 */
export async function crawlLeadSite(website: string): Promise<CrawlResult> {
  const startedAt = Date.now();
  const result: CrawlResult = { emails: [], phones: [], pagesFetched: 0, denied: null };

  let base: URL;
  try {
    base = new URL(website.includes("://") ? website : "https://" + website);
  } catch {
    return result; // unusable website value — nothing to crawl
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") return result;
  const domainKey = stripWww(base.hostname);

  const domainRow = await qOne({
    sql: "SELECT * FROM crawl_domains WHERE domain = ?",
    args: [domainKey],
  });
  if (domainRow && Number(domainRow.denied) === 1) {
    result.denied = domainRow.denied_reason ? String(domainRow.denied_reason) : "denied";
    return result; // permanent skip — no fetches, ever
  }

  const { robots, decision, fetchedNow } = await loadRobots(domainKey, base.origin, domainRow);
  const delayMs = crawlDelaySeconds(robots) * 1000;
  let lastFetchAt = fetchedNow ? Date.now() : 0;

  const emails = new Map<string, ExtractedContact>();
  const phones = new Map<string, ExtractedContact>();

  const queue: string[] = [];
  const queued = new Set<string>();
  const push = (href: string): void => {
    if (!queued.has(href)) {
      queued.add(href);
      queue.push(href);
    }
  };
  push(new URL("/", base).href); // homepage first — it feeds link discovery
  for (const p of PRIORITY_PATHS) push(new URL(p, base).href);

  if (!robots.disallowAll) {
    for (let i = 0; i < queue.length && result.pagesFetched < MAX_PAGES; i++) {
      const url = queue[i];
      const path = new URL(url).pathname + new URL(url).search;
      if (!isAllowed(robots, path)) {
        await logCrawl(url, domainKey, null, "disallowed", "denied");
        continue;
      }

      // Politeness + total budget: stop early rather than overshoot ~40s.
      const wait = Math.max(0, lastFetchAt + delayMs - Date.now());
      if (Date.now() - startedAt + wait + PAGE_TIMEOUT_MS > TOTAL_BUDGET_MS) break;
      if (wait > 0) await sleep(wait);

      let page: { status: number; body: string; finalUrl: string };
      try {
        page = await fetchWithTimeout(url);
      } catch {
        lastFetchAt = Date.now();
        await logCrawl(url, domainKey, null, decision, "error");
        continue;
      }
      lastFetchAt = Date.now();
      result.pagesFetched++;

      if (DENY_STATUSES.has(page.status)) {
        const reason = `http_${page.status}`;
        await denyDomain(domainKey, reason);
        await logCrawl(url, domainKey, page.status, decision, "denied");
        result.denied = reason;
        break; // STOP permanently — no login/CAPTCHA/paywall code path exists
      }
      const bodyLower = page.body.toLowerCase();
      const captcha = CAPTCHA_MARKERS.find((marker) => bodyLower.includes(marker));
      if (captcha) {
        const reason = `captcha_marker:${captcha}`;
        await denyDomain(domainKey, reason);
        await logCrawl(url, domainKey, page.status, decision, "denied");
        result.denied = reason;
        break;
      }
      if (page.status < 200 || page.status >= 300 || !page.body) {
        await logCrawl(url, domainKey, page.status, decision, "nothing_found");
        continue;
      }
      // A redirect that left the site means this page isn't the lead's own.
      try {
        if (stripWww(new URL(page.finalUrl).hostname) !== domainKey) {
          await logCrawl(url, domainKey, page.status, decision, "nothing_found");
          continue;
        }
      } catch {
        /* keep the original URL's host */
      }

      const extracted = extractContacts(page.body, url);
      for (const e of extracted.emails) if (!emails.has(e.value)) emails.set(e.value, e);
      for (const p of extracted.phones) if (!phones.has(p.value)) phones.set(p.value, p);
      const found = extracted.emails.length + extracted.phones.length;
      await logCrawl(
        url,
        domainKey,
        page.status,
        decision,
        found > 0 ? "extracted" : extracted.noHarvestSkipped ? "skipped_no_harvest" : "nothing_found",
      );

      if (i === 0) {
        for (const link of discoverLinks(page.body, base, domainKey)) push(link);
      }
    }
  }

  await q({
    sql: `UPDATE crawl_domains SET last_crawled_at = ?, pages_fetched = pages_fetched + ?
          WHERE domain = ?`,
    args: [nowIso(), result.pagesFetched, domainKey],
  });

  result.emails = [...emails.values()];
  result.phones = [...phones.values()];
  return result;
}

async function denyDomain(domainKey: string, reason: string): Promise<void> {
  await q({
    sql: "UPDATE crawl_domains SET denied = 1, denied_reason = ? WHERE domain = ?",
    args: [reason, domainKey],
  });
}
