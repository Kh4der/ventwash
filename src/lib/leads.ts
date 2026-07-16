import { getDb, q, qOne, nowIso } from "@/lib/db";
import { toE164US } from "@/lib/phone";
import { resolveTimezone } from "@/lib/compliance/tz";
import { sha256, writeAudit } from "@/lib/compliance/audit";
import { cancelJobsForLead } from "@/lib/jobs";
import { captureServerEvent } from "@/lib/posthog-server";

/**
 * Lead CRUD. Status only ever changes through lead-machine.ts transition();
 * consent_tier only through compliance/consent.ts. This module owns identity:
 * dedupe keys, tombstone checks, privacy deletion.
 */

export type DiscoverySource =
  | "osm"
  | "csv_import"
  | "own_website"
  | "gov_open_data"
  | "inbound_form"
  | "inbound_call"
  | "manual";

export interface NewLead {
  discoverySource: DiscoverySource;
  businessName: string;
  contactName?: string;
  phone?: string; // any format; normalized to E.164 here
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  region?: string;
  postal?: string;
  lat?: number;
  lng?: number;
  cuisine?: string;
  hoods?: string;
  notes?: string;
  osmId?: string;
  posthogDistinctId?: string;
  provenanceNote?: string;
  /** Initial status; inbound sources enter at 'engaged'. */
  status?: "discovered" | "engaged";
}

function hostOf(website: string | undefined): string | null {
  if (!website) return null;
  try {
    return new URL(website.includes("://") ? website : "https://" + website).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * First non-empty of: E.164 phone | lower(email) | website host |
 * slug(name + coarse location). Every insert path must use this.
 */
export function dedupeKey(lead: {
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  businessName: string;
  postal?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
}): string {
  const phone = toE164US(lead.phone ?? undefined);
  if (phone) return "p:" + phone;
  const email = (lead.email ?? "").trim().toLowerCase();
  if (email) return "e:" + email;
  const host = hostOf(lead.website ?? undefined);
  if (host) return "w:" + host;
  const loc =
    (lead.postal ?? "").trim() ||
    (lead.city ?? "").trim().toLowerCase() ||
    (lead.lat != null && lead.lng != null
      ? lead.lat.toFixed(2) + "," + lead.lng.toFixed(2)
      : "");
  return "n:" + slug(lead.businessName) + "@" + slug(loc);
}

/** Hashes for the tombstone table (privacy deletion re-creation guard). */
export function tombstoneHashes(lead: {
  phone_e164?: string | null;
  email?: string | null;
  website?: string | null;
}): string[] {
  const out: string[] = [];
  if (lead.phone_e164) out.push(sha256("p:" + lead.phone_e164));
  if (lead.email) out.push(sha256("e:" + String(lead.email).trim().toLowerCase()));
  const host = hostOf(lead.website ?? undefined);
  if (host) out.push(sha256("w:" + host));
  return out;
}

export interface CreateResult {
  id: string;
  created: boolean; // false = deduped onto an existing lead
  blocked?: "tombstone";
}

/**
 * Insert a lead with tombstone + dedupe checks. Returns the existing lead's
 * id when the dedupe key matches (discovery re-runs are idempotent), and
 * refuses to re-create a privacy-deleted contact.
 */
export async function createLead(input: NewLead): Promise<CreateResult | null> {
  const db = await getDb();
  if (!db) return null;

  if (input.discoverySource === "manual" && !input.provenanceNote?.trim()) {
    throw new Error("provenance_note is required for manual leads");
  }

  const phone = toE164US(input.phone);
  const email = (input.email ?? "").trim().toLowerCase() || null;
  const key = dedupeKey({
    phone: input.phone,
    email,
    website: input.website,
    businessName: input.businessName,
    postal: input.postal,
    city: input.city,
    lat: input.lat,
    lng: input.lng,
  });

  // Tombstone check: a deleted contact must not be re-created by discovery.
  const hashes = tombstoneHashes({ phone_e164: phone, email, website: input.website });
  if (hashes.length) {
    const placeholders = hashes.map(() => "?").join(",");
    const hit = await qOne({
      sql: `SELECT hash FROM tombstones WHERE hash IN (${placeholders}) LIMIT 1`,
      args: hashes,
    });
    if (hit) return { id: "", created: false, blocked: "tombstone" };
  }

  const existing = await qOne({
    sql: "SELECT id FROM leads WHERE dedupe_key = ? AND deleted_at IS NULL",
    args: [key],
  });
  if (existing) return { id: String(existing.id), created: false };

  const id = crypto.randomUUID();
  const now = nowIso();
  const status = input.status ?? "discovered";
  const inbound = input.discoverySource === "inbound_form" || input.discoverySource === "inbound_call";
  const timezone = resolveTimezone({
    postal: input.postal,
    region: input.region,
    phone_e164: phone,
  });

  const insert = await db.execute({
    sql: `INSERT INTO leads (
            id, created_at, updated_at, status, discovery_source, provenance_note,
            business_name, contact_name, phone_e164, email, website,
            address, city, region, postal, lat, lng, timezone, cuisine, hoods, notes,
            approval, posthog_distinct_id, osm_id, dedupe_key
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(dedupe_key) WHERE deleted_at IS NULL DO NOTHING`,
    args: [
      id, now, now, status, input.discoverySource, input.provenanceNote ?? null,
      input.businessName.trim(), input.contactName?.trim() ?? "", phone, email,
      input.website?.trim() || null,
      input.address ?? null, input.city ?? null, input.region ?? null, input.postal ?? null,
      input.lat ?? null, input.lng ?? null, timezone, input.cuisine ?? "", input.hoods ?? "",
      input.notes ?? "",
      inbound ? "not_required" : "pending",
      input.posthogDistinctId ?? null, input.osmId ?? null, key,
    ],
  });

  // Only write the 'created' timeline row if we actually inserted — a
  // concurrent insert can win the ON CONFLICT race, and an event referencing
  // the discarded UUID would be an orphan against the append-only table.
  if (insert.rowsAffected > 0) {
    await db.execute({
      sql: `INSERT INTO lead_events (lead_id, at, type, to_status, actor, meta)
            VALUES (?, ?, 'created', ?, 'system', ?)`,
      args: [id, now, status, JSON.stringify({ source: input.discoverySource })],
    });
  }

  const winner = await qOne({
    sql: "SELECT id FROM leads WHERE dedupe_key = ? AND deleted_at IS NULL",
    args: [key],
  });
  const finalId = winner ? String(winner.id) : id;
  const created = insert.rowsAffected > 0 && finalId === id;

  if (created) {
    await captureServerEvent(
      "lead_created",
      { lead_id: finalId, source: input.discoverySource, status },
      input.posthogDistinctId,
    );
  }

  return { id: finalId, created };
}

export async function getLead(id: string): Promise<Record<string, unknown> | null> {
  return qOne({ sql: "SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL", args: [id] });
}

export async function getLeadByPhone(e164: string): Promise<Record<string, unknown> | null> {
  return qOne({
    sql: "SELECT * FROM leads WHERE phone_e164 = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
    args: [e164],
  });
}

/** Editable fields for PATCH /api/admin/leads/[id] — never status/consent/approval. */
const EDITABLE = new Set([
  "business_name", "contact_name", "email", "website", "address", "city",
  "region", "postal", "cuisine", "hoods", "notes", "timezone",
]);

export async function updateLeadFields(
  id: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  const entries = Object.entries(fields).filter(([k]) => EDITABLE.has(k));
  if (!entries.length) return false;
  const sets = entries.map(([k]) => `${k} = ?`).join(", ");
  await q({
    sql: `UPDATE leads SET ${sets}, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    args: [...entries.map(([, v]) => (v as never) ?? null), nowIso(), id],
  });
  return true;
}

/**
 * Privacy deletion: null PII, mark deleted, write tombstones, preserve the
 * contact in DNC/suppression so they are never contacted again, cancel queued
 * jobs. Consent/revocation/audit history is preserved (legal record).
 * Provider-side artifacts (Vapi recordings etc.) are cleaned up best-effort
 * by the caller (admin route) via the voice helpers.
 */
export async function deleteLead(id: string, actor: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const lead = await getLead(id);
  if (!lead) return false;

  const now = nowIso();
  const stmts = [];

  for (const hash of tombstoneHashes({
    phone_e164: lead.phone_e164 as string | null,
    email: lead.email as string | null,
    website: lead.website as string | null,
  })) {
    stmts.push({
      sql: "INSERT OR IGNORE INTO tombstones (hash, created_at) VALUES (?, ?)",
      args: [hash, now],
    });
  }
  if (lead.phone_e164) {
    stmts.push({
      sql: "INSERT OR IGNORE INTO dnc_internal (phone_e164, reason, added_by, added_at) VALUES (?, 'deletion_request', ?, ?)",
      args: [String(lead.phone_e164), actor, now],
    });
  }
  if (lead.email) {
    stmts.push({
      sql: "INSERT OR IGNORE INTO email_suppressions (email, reason, source, added_at) VALUES (?, 'deletion_request', 'delete_lead', ?)",
      args: [String(lead.email), now],
    });
  }
  stmts.push({
    // dedupe_key holds a plaintext identifier (phone/email/host) and must be
    // scrubbed too, or the deleted contact is recoverable from that column.
    // The unique index is partial (WHERE deleted_at IS NULL), so a deleted
    // row can safely take a non-unique placeholder.
    sql: `UPDATE leads SET
            business_name = '[deleted]', contact_name = '', phone_e164 = NULL,
            email = NULL, website = NULL, address = NULL, city = NULL,
            postal = NULL, lat = NULL, lng = NULL, notes = '',
            dedupe_key = 'deleted:' || id,
            deleted_at = ?, updated_at = ?
          WHERE id = ?`,
    args: [now, now, id],
  });
  stmts.push({
    sql: `INSERT INTO lead_events (lead_id, at, type, actor, meta)
          VALUES (?, ?, 'deletion', ?, '{}')`,
    args: [id, now, actor],
  });
  // PII embedded in free-text side tables goes too (timeline metadata stays).
  stmts.push({
    sql: "UPDATE messages SET body = '[deleted]', to_addr = '[deleted]', subject = '' WHERE lead_id = ?",
    args: [id],
  });
  stmts.push({
    sql: "UPDATE call_attempts SET transcript = NULL, summary = NULL, recording_url = NULL WHERE lead_id = ?",
    args: [id],
  });
  stmts.push({
    sql: "DELETE FROM contact_points WHERE lead_id = ?",
    args: [id],
  });

  await db.batch(stmts, "write");
  await cancelJobsForLead(id);
  await writeAudit({ actor, action: "lead_deleted", leadId: id });
  await captureServerEvent("lead_deleted", { lead_id: id });
  return true;
}
