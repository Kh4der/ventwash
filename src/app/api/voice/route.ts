/**
 * POST /api/voice — voice-automation webhook (STUB).
 *
 * This is the landing zone for the AI phone-answering integration described
 * in docs/voice-automation-plan.md. When the voice platform (Vapi or similar)
 * is wired up, its webhooks will POST here and this route will:
 *
 *   1. Validate a shared-secret header from the voice platform.
 *   2. Validate the payload (call metadata / extracted quote slots).
 *   3. Capture PostHog events server-side (same pipeline as the web quote form):
 *        - call_received        { intent, after_hours, duration }
 *        - call_quote_captured  { name, business, phone, email, hoods, message,
 *                                 source: 'phone' }
 *      so phone leads appear in the /admin leads table alongside web
 *      quote_submitted leads.
 *
 * Until then it returns 501 for POST and a stub status for GET.
 */

export async function POST(request: Request) {
  // Intentionally unused until the integration lands; kept in the signature
  // so the webhook contract is explicit.
  void request;

  return Response.json(
    {
      error:
        'Voice automation is not configured yet. See docs/voice-automation-plan.md.',
    },
    { status: 501 },
  );
}

export async function GET() {
  return Response.json({ status: 'stub' });
}
