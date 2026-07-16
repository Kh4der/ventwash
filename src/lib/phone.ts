/**
 * US phone number normalization. Every phone number stored anywhere in the
 * database MUST pass through toE164US first — DNC scrubbing, revocation
 * matching, and dedupe keys all assume E.164.
 */

/** Normalize a US phone number to E.164 (+1XXXXXXXXXX). Returns null if it can't be. */
export function toE164US(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/\D/g, "");
  let national: string;
  if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits.startsWith("1")) national = digits.slice(1);
  else return null;
  // NANP: area code and exchange can't start with 0 or 1.
  if (/[01]/.test(national[0]) || /[01]/.test(national[3])) return null;
  return "+1" + national;
}

/** US area code (3 digits) from an E.164 number, or null. */
export function areaCode(e164: string | null | undefined): string | null {
  if (!e164 || !/^\+1\d{10}$/.test(e164)) return null;
  return e164.slice(2, 5);
}

/** Pretty-print an E.164 US number for UI/read-back: (555) 123-4567. */
export function formatUS(e164: string | null | undefined): string {
  if (!e164 || !/^\+1\d{10}$/.test(e164)) return e164 || "";
  return `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
}
