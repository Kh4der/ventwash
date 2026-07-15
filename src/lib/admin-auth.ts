import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "vw_admin";

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret(): string | null {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // Fail closed: without either secret the HMAC key would be a constant
  // derivable from public source code, so refuse to sign/verify anything.
  if (!process.env.ADMIN_PASSWORD) return null;
  return createHash("sha256")
    .update("ventwash:" + process.env.ADMIN_PASSWORD)
    .digest("hex");
}

function sign(payload: string): string | null {
  const secret = getSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/** Creates a signed session token valid for 7 days. */
export function createSessionToken(): string {
  const expiry = Date.now() + SESSION_DURATION_MS;
  const payload = base64url(String(expiry));
  const signature = sign(payload);
  if (!signature) {
    throw new Error("Cannot create session: SESSION_SECRET/ADMIN_PASSWORD not set");
  }
  return payload + "." + signature;
}

/** Verifies structure, HMAC signature (constant-time) and expiry. */
export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  if (!payload || !signature) return false;

  const expected = sign(payload);
  if (!expected) return false;
  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return false;
  if (!timingSafeEqual(sigBuf, expBuf)) return false;

  let expiry: number;
  try {
    expiry = Number(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (!Number.isFinite(expiry)) return false;
  return Date.now() < expiry;
}

/** Constant-time password check. False when ADMIN_PASSWORD is not set. */
export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  // Hash both sides so buffers always have equal length.
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
