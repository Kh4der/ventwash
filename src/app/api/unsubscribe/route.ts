import { verifyLinkToken } from "@/lib/link-tokens";
import { getLead } from "@/lib/leads";
import { revokeConsent, isRevoked } from "@/lib/compliance/consent";

/**
 * GET /api/unsubscribe?token= — CAN-SPAM one-click unsubscribe.
 *
 * The token is an HMAC-signed link token (purpose 'unsubscribe', subject =
 * lead id, 90-day TTL, minted when the cold email is rendered). A valid
 * token immediately runs the revokeConsent pipeline for the email channel —
 * no login, no confirmation step — and renders a tiny branded confirmation.
 * Idempotent: repeat clicks skip the (append-only) revocation and land on
 * the same confirmation page.
 */

const MONO = "'IBM Plex Mono',Consolas,monospace";
const HEAD = "'Archivo',Arial,Helvetica,sans-serif";

function page(kicker: string, heading: string, message: string, status: number): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>VentWash</title>
</head>
<body style="margin:0;padding:0;background:#f3f8fb;">
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;">
    <div style="max-width:440px;width:100%;background:#ffffff;border:1px solid rgba(26,33,41,.1);border-radius:6px;padding:36px;text-align:center;">
      <div style="font-family:${MONO};font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#3E6FA6;margin-bottom:14px;">${kicker}</div>
      <h1 style="font-family:${HEAD};font-weight:800;font-size:24px;line-height:1.25;color:#1a2129;margin:0 0 12px;">${heading}</h1>
      <p style="font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.6;color:#414c57;margin:0;">${message}</p>
      <div style="font-family:${MONO};font-size:10.5px;letter-spacing:.1em;color:#8a94a0;margin-top:24px;">VENTWASH &middot; NFPA 96 HOOD &amp; EXHAUST CLEANING</div>
    </div>
  </div>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") ?? "").slice(0, 512);

  const leadId = verifyLinkToken("unsubscribe", token);
  if (!leadId) {
    return page(
      "Link expired",
      "This link has expired.",
      "The unsubscribe link is invalid or has expired. Reply to any email from us and we'll remove you by hand.",
      400,
    );
  }

  // The lead may already be privacy-deleted (getLead returns null) — its
  // email is already suppressed by the deletion cascade, so just confirm.
  const lead = await getLead(leadId);
  const email = lead ? String(lead.email ?? "").trim().toLowerCase() : "";

  const already = await isRevoked({ id: leadId, email: email || null }, "email");
  if (!already) {
    await revokeConsent({
      leadId,
      email: email || null,
      channel: "email",
      source: "email_unsubscribe",
      evidence: "one-click unsubscribe " + token.slice(0, 12),
    });
  }

  return page(
    "Unsubscribed",
    "You're unsubscribed.",
    "No more emails from VentWash. If this was a mistake, reply to any previous email and we'll sort it out.",
    200,
  );
}
