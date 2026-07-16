/**
 * Hand-rolled CSV parsing for the admin lead import (D7: csv_import source).
 * RFC 4180 semantics: quoted fields, escaped quotes (""), CR/LF/CRLF line
 * endings, embedded newlines inside quotes. No dependency, no eval — the
 * input is an untrusted upload, so everything is treated as plain text.
 */

/** Parse CSV text into rows of raw cell strings (fully-empty rows dropped). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // strip BOM

  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++; // CRLF
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** First row = headers; remaining rows become header-keyed records. */
export function mapCsvRows(text: string): { rows: Record<string, string>[]; headers: string[] } {
  const parsed = parseCsv(text);
  if (parsed.length === 0) return { rows: [], headers: [] };
  const headers = parsed[0].map((h) => h.trim());
  const rows = parsed.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (header) record[header] = (cells[idx] ?? "").trim();
    });
    return record;
  });
  return { rows, headers };
}

/**
 * Guess which header holds a field, given candidate names in preference
 * order (e.g. name/phone/email/website/address/city/state/zip candidates).
 * Exact normalized match wins over substring match. Returns the actual
 * header string, or null.
 */
export function guessColumn(headers: string[], candidates: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const candidate of candidates) {
    const c = norm(candidate);
    if (!c) continue;
    const exact = headers.find((h) => norm(h) === c);
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const c = norm(candidate);
    if (!c) continue;
    const partial = headers.find((h) => norm(h).includes(c));
    if (partial) return partial;
  }
  return null;
}
