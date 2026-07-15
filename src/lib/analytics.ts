"use client";

import posthog from "posthog-js";

/**
 * Safe client-side event capture. No-ops when PostHog isn't configured,
 * so the site works without keys during development.
 *
 * Event vocabulary used across the site:
 *  - section_viewed        { section_id, section_index }
 *  - experience_completed  {}
 *  - quote_cta_clicked     { location }   location: 'header' | 'finale' | 'end'
 *  - call_cta_clicked      { location }
 *  - whatsapp_cta_clicked  { location }
 *  - quote_submitted       { business, hoods }  (full lead captured server-side)
 */
export function track(event: string, properties?: Record<string, unknown>) {
  try {
    if (posthog.__loaded) posthog.capture(event, properties);
  } catch {
    // analytics must never break the experience
  }
}
