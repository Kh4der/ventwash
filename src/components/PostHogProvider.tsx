"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

// Initializes PostHog once on the client. Events flow through the /ingest
// Next.js rewrite (see next.config.ts) so ad blockers don't eat them.
export function PHProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key || posthog.__loaded) return;
    posthog.init(key, {
      api_host: "/ingest",
      ui_host: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || "https://us.posthog.com",
      defaults: "2025-05-24",
      capture_pageview: "history_change",
      capture_pageleave: true,
    });
  }, []);

  return <>{children}</>;
}
