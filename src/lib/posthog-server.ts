import { PostHog } from "posthog-node";

/**
 * Server-side PostHog capture helper.
 *
 * - No-ops when NEXT_PUBLIC_POSTHOG_KEY isn't configured, so the site works
 *   without analytics keys in development.
 * - Uses a module-level singleton client with flushAt:1 / flushInterval:0 so
 *   events are sent immediately (serverless-friendly).
 * - Never throws: analytics failures must not break lead capture.
 */

let client: PostHog | null = null;

function getClient(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  if (!client) {
    client = new PostHog(key, {
      host: process.env.NEXT_PUBLIC_POSTHOG_INGEST_HOST || "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}

export async function captureServerEvent(
  event: string,
  properties: Record<string, unknown>,
  distinctId?: string
): Promise<void> {
  const ph = getClient();
  if (!ph) return;
  try {
    const message = {
      distinctId: distinctId || "server",
      event,
      properties,
    };
    if (typeof ph.captureImmediate === "function") {
      // Available in the installed posthog-node: sends and awaits delivery.
      await ph.captureImmediate(message);
    } else {
      ph.capture(message);
      await ph.flush();
    }
  } catch (err) {
    // Never let analytics break the request path.
    console.error("[posthog-server] capture failed:", err);
  }
}
