/**
 * Minimal robots.txt parser — FAIL CLOSED. Unparseable or empty-after-parse
 * robots.txt means disallow-all: if a site operator's intent can't be read,
 * we don't crawl. Standard group semantics: the group naming our token
 * ("VentWashLeadBot") wins over "*"; Allow/Disallow use longest-match-wins
 * with "*" wildcards and "$" end anchors; Crawl-delay is honored with a
 * 3-second floor.
 */

export const OUR_UA_TOKEN = "ventwashleadbot";

export interface RobotsRule {
  allow: boolean;
  path: string;
}

export interface Robots {
  disallowAll: boolean;
  rules: RobotsRule[];
  crawlDelay: number | null;
}

/** Allow-all robots (used for hosts with no robots.txt at all — HTTP 404). */
export const ALLOW_ALL: Robots = { disallowAll: false, rules: [], crawlDelay: null };

export function parseRobots(txt: string): Robots {
  const ourRules: RobotsRule[] = [];
  const starRules: RobotsRule[] = [];
  let ourDelay: number | null = null;
  let starDelay: number | null = null;
  let sawOurGroup = false;
  let sawStarGroup = false;
  let appliesOur = false;
  let appliesStar = false;
  let inGroupRules = false;
  let directives = 0;

  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      directives++;
      if (inGroupRules) {
        appliesOur = false;
        appliesStar = false;
        inGroupRules = false;
      }
      const ua = value.toLowerCase();
      if (ua.includes(OUR_UA_TOKEN)) {
        appliesOur = true;
        sawOurGroup = true;
      }
      if (ua === "*") {
        appliesStar = true;
        sawStarGroup = true;
      }
    } else if (field === "allow" || field === "disallow") {
      directives++;
      inGroupRules = true;
      if (!value) continue; // "Disallow:" (empty) restricts nothing
      const rule = { allow: field === "allow", path: value };
      if (appliesOur) ourRules.push(rule);
      if (appliesStar) starRules.push(rule);
    } else if (field === "crawl-delay") {
      directives++;
      inGroupRules = true;
      const secs = Number(value);
      if (Number.isFinite(secs) && secs >= 0) {
        if (appliesOur) ourDelay = secs;
        if (appliesStar && starDelay === null) starDelay = secs;
      }
    }
  }

  // Fail closed: nothing parseable came out of the file.
  if (directives === 0) return { disallowAll: true, rules: [], crawlDelay: null };
  // Most specific matching group wins; a robots.txt that names other bots
  // but neither us nor "*" restricts us not at all (standard semantics).
  if (sawOurGroup) return { disallowAll: false, rules: ourRules, crawlDelay: ourDelay };
  if (sawStarGroup) return { disallowAll: false, rules: starRules, crawlDelay: starDelay };
  return { disallowAll: false, rules: [], crawlDelay: null };
}

/** Pattern match with "*" wildcards / "$" anchor; returns specificity (pattern length) or -1. */
function matchLength(pattern: string, path: string): number {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  let re = "^";
  for (const ch of body) {
    re += ch === "*" ? ".*" : ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  if (anchored) re += "$";
  try {
    return new RegExp(re).test(path) ? pattern.length : -1;
  } catch {
    return -1;
  }
}

/** Longest-match-wins; Allow wins ties; no matching rule ⇒ allowed. */
export function isAllowed(robots: Robots, path: string): boolean {
  if (robots.disallowAll) return false;
  let best: { len: number; allow: boolean } | null = null;
  for (const rule of robots.rules) {
    const len = matchLength(rule.path, path || "/");
    if (len < 0) continue;
    if (!best || len > best.len || (len === best.len && rule.allow && !best.allow)) {
      best = { len, allow: rule.allow };
    }
  }
  return best ? best.allow : true;
}

/** Politeness delay between requests to one host: Crawl-delay, floored at 3s. */
export function crawlDelaySeconds(robots: Robots): number {
  return Math.max(3, robots.crawlDelay ?? 3);
}
