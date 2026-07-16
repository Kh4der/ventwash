/**
 * Contact extraction from public HTML — deliberately conservative. Sources:
 * mailto:/tel: links, JSON-LD LocalBusiness/Restaurant blocks, and a plain
 * regex over visible text. The NO-HARVEST heuristic (CAN-SPAM defense, D9)
 * skips any email whose surrounding text signals "don't harvest me" —
 * "no spam", "do not use this", "not for solicitation", or [at]/[dot]-style
 * obfuscation. Phones are normalized to E.164 before they leave this module.
 */

import { toE164US } from "@/lib/phone";

export interface ExtractedContact {
  value: string;
  sourceUrl: string;
}

export interface ExtractResult {
  emails: ExtractedContact[];
  phones: ExtractedContact[];
  /** True when at least one email was found but withheld by the no-harvest heuristic. */
  noHarvestSkipped: boolean;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MAILTO_RE = /href\s*=\s*["']mailto:([^"'?]+)["'?]/gi;
const TEL_RE = /href\s*=\s*["']tel:([^"']+)["']/gi;
const JSONLD_RE = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const NO_HARVEST_MARKERS = ["no spam", "do not use this", "not for solicitation"];
const OBFUSCATION_RE = /\[\s*(?:at|dot)\s*\]|\(\s*(?:at|dot)\s*\)/i;
/** Common junk: placeholder domains, telemetry, platform noise, image "@2x" false positives. */
const JUNK_EMAIL_RE =
  /(@|\.)example\.(com|org|net)$|sentry|wixpress|\.(png|jpe?g|gif|webp|svg|ico|css|js|woff2?)$/i;

function isJunkEmail(email: string): boolean {
  if (email.length > 80 || email.includes("..")) return true;
  return JUNK_EMAIL_RE.test(email);
}

/** True when the ±100 chars around a match signal "do not harvest this address". */
function noHarvestContext(text: string, index: number, matchLength: number): boolean {
  const ctx = text.slice(Math.max(0, index - 100), index + matchLength + 100).toLowerCase();
  return NO_HARVEST_MARKERS.some((m) => ctx.includes(m)) || OBFUSCATION_RE.test(ctx);
}

function stripToVisibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
}

/** Extract provenanced contact info from one fetched page. */
export function extractContacts(html: string, sourceUrl: string): ExtractResult {
  const emails = new Map<string, ExtractedContact>();
  const phones = new Map<string, ExtractedContact>();
  let noHarvestSkipped = false;

  const addEmail = (raw: string): void => {
    const value = raw.trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return;
    if (isJunkEmail(value)) return;
    if (!emails.has(value)) emails.set(value, { value, sourceUrl });
  };
  const addPhone = (raw: string): void => {
    const e164 = toE164US(raw);
    if (!e164) return;
    if (!phones.has(e164)) phones.set(e164, { value: e164, sourceUrl });
  };

  // 1. mailto: / tel: links (context-checked against the raw markup).
  for (const m of html.matchAll(MAILTO_RE)) {
    if (noHarvestContext(html, m.index ?? 0, m[0].length)) {
      noHarvestSkipped = true;
      continue;
    }
    addEmail(m[1]);
  }
  for (const m of html.matchAll(TEL_RE)) addPhone(m[1]);

  // 2. JSON-LD LocalBusiness / Restaurant structured data.
  for (const m of html.matchAll(JSONLD_RE)) {
    try {
      walkJsonLd(JSON.parse(m[1]), 0, addEmail, addPhone);
    } catch {
      // malformed JSON-LD — ignore the block
    }
  }

  // 3. Conservative regex over visible text.
  const text = stripToVisibleText(html);
  for (const m of text.matchAll(EMAIL_RE)) {
    const candidate = m[0].toLowerCase();
    if (isJunkEmail(candidate)) continue;
    if (noHarvestContext(text, m.index ?? 0, m[0].length)) {
      noHarvestSkipped = true;
      continue;
    }
    addEmail(candidate);
  }

  return { emails: [...emails.values()], phones: [...phones.values()], noHarvestSkipped };
}

function walkJsonLd(
  node: unknown,
  depth: number,
  addEmail: (raw: string) => void,
  addPhone: (raw: string) => void,
): void {
  if (depth > 6 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLd(item, depth + 1, addEmail, addPhone);
    return;
  }
  const obj = node as Record<string, unknown>;
  const typeField = obj["@type"];
  const types = Array.isArray(typeField) ? typeField : [typeField];
  const isBusiness = types.some(
    (t) => typeof t === "string" && /LocalBusiness|Restaurant|FoodEstablishment/i.test(t),
  );
  if (isBusiness) {
    if (typeof obj.email === "string") addEmail(obj.email.replace(/^mailto:/i, ""));
    if (typeof obj.telephone === "string") addPhone(obj.telephone);
  }
  for (const value of Object.values(obj)) walkJsonLd(value, depth + 1, addEmail, addPhone);
}
