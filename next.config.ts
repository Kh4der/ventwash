import type { NextConfig } from "next";

const POSTHOG_INGEST =
  process.env.NEXT_PUBLIC_POSTHOG_INGEST_HOST || "https://us.i.posthog.com";
const POSTHOG_ASSETS =
  process.env.NEXT_PUBLIC_POSTHOG_ASSETS_HOST || "https://us-assets.i.posthog.com";

const nextConfig: NextConfig = {
  // Proxy PostHog ingestion through the site's own origin so ad blockers
  // don't drop analytics events.
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: `${POSTHOG_ASSETS}/static/:path*`,
      },
      {
        source: "/ingest/:path*",
        destination: `${POSTHOG_INGEST}/:path*`,
      },
    ];
  },
  // PostHog's ingestion API relies on trailing-slash variants of some paths.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
