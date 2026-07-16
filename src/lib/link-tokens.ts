import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed link tokens for customer-facing URLs (appointment
 * confirm/reschedule, one-click unsubscribe). Same signing pattern as
 * admin-auth.ts: base64url(payload) + "." + hex HMAC, verified in constant
 * time. Payload = purpose|subjectId|expiryMs.
 *
 * Signing key: APPOINTMENT_LINK_SECRET, falling back to SESSION_SECRET so a
 * configured admin panel implies working links. No secret at all ⇒ tokens
 * cannot be created or verified (fail closed).
 */

function getSecret(): string | null {
  return process.env.APPOINTMENT_LINK_SECRET || process.env.SESSION_SECRET || null;
}

function sign(payload: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  return createHmac("sha256", "vw-link:" + secret).update(payload).digest("hex");
}

export type LinkPurpose = "appointment" | "unsubscribe";

export function createLinkToken(
  purpose: LinkPurpose,
  subjectId: string,
  ttlMs: number,
): string | null {
  const expiry = Date.now() + ttlMs;
  const payload = Buffer.from(`${purpose}|${subjectId}|${expiry}`, "utf8").toString("base64url");
  const signature = sign(payload);
  if (!signature) return null;
  return payload + "." + signature;
}

/** Returns the subject id when the token is valid and unexpired, else null. */
export function verifyLinkToken(purpose: LinkPurpose, token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  const expected = sign(payload);
  if (!expected) return null;
  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [p, subjectId, expiryStr] = decoded.split("|");
  if (p !== purpose || !subjectId) return null;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || Date.now() >= expiry) return null;
  return subjectId;
}

/** Absolute base URL for customer-facing links. */
export function siteBaseUrl(): string {
  return (
    process.env.SITE_BASE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL
      : "http://localhost:3000")
  );
}
