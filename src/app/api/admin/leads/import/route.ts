import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { createLead } from "@/lib/leads";
import { enqueue } from "@/lib/jobs";
import { writeAudit } from "@/lib/compliance/audit";
import { mapCsvRows, guessColumn } from "@/lib/discovery/csv";

/**
 * POST /api/admin/leads/import — CSV lead import. Accepts a raw text/csv body
 * or JSON { csv }. Columns are guessed from the headers; each row runs
 * through createLead (discovery_source 'csv_import' ⇒ tier 'none', approval
 * 'pending') which enforces tombstones + dedupe. Created leads get
 * lookup_line_type + score_lead jobs. Hard-capped at 500 rows per request;
 * the first 5 mapped rows come back so the UI can verify the column mapping.
 */

const MAX_ROWS = 500;
const MAX_CSV_BYTES = 2_000_000;

const COLUMN_CANDIDATES: Record<string, string[]> = {
  name: ["business_name", "business", "name", "company", "company_name", "restaurant"],
  phone: ["phone", "phone_number", "telephone", "tel", "phone_e164", "mobile", "contact_phone"],
  email: ["email", "e_mail", "e-mail", "email_address", "contact_email"],
  website: ["website", "url", "web", "site", "homepage", "domain"],
  address: ["address", "street", "street_address", "address1", "addr"],
  city: ["city", "town", "municipality"],
  state: ["state", "region", "province", "st", "state_code"],
  zip: ["zip", "zip_code", "zipcode", "postal", "postal_code", "postcode"],
};

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  // Accept raw CSV or JSON { csv: "..." }.
  let csv = "";
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
      csv = await request.text();
    } else {
      const body = (await request.json()) as Record<string, unknown>;
      csv = typeof body.csv === "string" ? body.csv : "";
    }
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!csv.trim()) {
    return Response.json({ error: "No CSV content provided" }, { status: 400 });
  }
  if (csv.length > MAX_CSV_BYTES) {
    return Response.json({ error: "CSV too large (2MB max)" }, { status: 400 });
  }

  try {
    const { rows, headers } = mapCsvRows(csv);
    if (!headers.length || !rows.length) {
      return Response.json({ error: "Could not parse any CSV rows" }, { status: 400 });
    }

    const columns: Record<string, string | null> = {};
    for (const [field, candidates] of Object.entries(COLUMN_CANDIDATES)) {
      columns[field] = guessColumn(headers, candidates);
    }
    if (!columns.name) {
      return Response.json(
        { error: "Could not identify a business-name column", headers },
        { status: 400 },
      );
    }

    const pick = (row: Record<string, string>, field: string): string =>
      (columns[field] ? String(row[columns[field] as string] ?? "") : "").trim().slice(0, 500);

    const counts = { created: 0, deduped: 0, tombstoned: 0, invalid: 0 };
    const samples: Record<string, string>[] = [];
    const capped = rows.slice(0, MAX_ROWS);

    for (const row of capped) {
      const mapped = {
        businessName: pick(row, "name"),
        phone: pick(row, "phone"),
        email: pick(row, "email"),
        website: pick(row, "website"),
        address: pick(row, "address"),
        city: pick(row, "city"),
        region: pick(row, "state"),
        postal: pick(row, "zip"),
      };
      if (samples.length < 5) samples.push({ ...mapped });

      if (!mapped.businessName) {
        counts.invalid++;
        continue;
      }

      try {
        const result = await createLead({
          discoverySource: "csv_import",
          businessName: mapped.businessName,
          phone: mapped.phone || undefined,
          email: mapped.email || undefined,
          website: mapped.website || undefined,
          address: mapped.address || undefined,
          city: mapped.city || undefined,
          region: mapped.region || undefined,
          postal: mapped.postal || undefined,
        });
        if (!result) {
          counts.invalid++;
        } else if (result.blocked === "tombstone") {
          counts.tombstoned++;
        } else if (!result.created) {
          counts.deduped++;
        } else {
          counts.created++;
          await enqueue({
            type: "lookup_line_type",
            payload: { leadId: result.id },
            leadId: result.id,
            idempotencyKey: `lookup:${result.id}`,
          });
          await enqueue({
            type: "score_lead",
            payload: { leadId: result.id },
            leadId: result.id,
            idempotencyKey: `score:${result.id}:import`,
          });
        }
      } catch {
        counts.invalid++;
      }
    }

    await writeAudit({ actor: "admin", action: "csv_import", meta: { ...counts } });

    return Response.json({
      ok: true,
      ...counts,
      totalRows: rows.length,
      processedRows: capped.length,
      columns,
      samples,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "CSV import failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
