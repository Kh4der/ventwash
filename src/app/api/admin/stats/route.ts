import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { runHogQL } from "@/lib/posthog-api";

// Whitelist mapping — never interpolate raw user input into HogQL.
const RANGE_DAYS: Record<string, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
};

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.POSTHOG_PERSONAL_API_KEY || !process.env.POSTHOG_PROJECT_ID) {
    return Response.json({ configured: false });
  }

  const url = new URL(request.url);
  const rangeParam = url.searchParams.get("range") || "14d";
  const range = rangeParam in RANGE_DAYS ? rangeParam : "14d";
  const N = RANGE_DAYS[range];

  try {
    const [daily, totals, sections, devices, pages, leads] = await Promise.all([
      runHogQL(
        `SELECT toDate(timestamp) AS day, countIf(event = '$pageview') AS pageviews, uniqExact(distinct_id) AS visitors FROM events WHERE timestamp >= now() - INTERVAL ${N} DAY GROUP BY day ORDER BY day ASC`,
      ),
      runHogQL(
        `SELECT countIf(event = '$pageview') AS pageviews, uniqExact(distinct_id) AS visitors, countIf(event = 'quote_submitted' AND toString(properties.source) = 'website_quote_form') AS quotes, countIf(event = 'quote_cta_clicked') AS cta_clicks, countIf(event = 'experience_completed') AS completions FROM events WHERE timestamp >= now() - INTERVAL ${N} DAY`,
      ),
      runHogQL(
        `SELECT toString(properties.section_id) AS section, uniqExact(distinct_id) AS visitors FROM events WHERE event = 'section_viewed' AND timestamp >= now() - INTERVAL ${N} DAY GROUP BY section`,
      ),
      runHogQL(
        `SELECT toString(properties.$device_type) AS device, uniqExact(distinct_id) AS visitors FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${N} DAY GROUP BY device ORDER BY visitors DESC`,
      ),
      runHogQL(
        `SELECT toString(properties.$pathname) AS path, count() AS views FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${N} DAY GROUP BY path ORDER BY views DESC LIMIT 10`,
      ),
      runHogQL(
        `SELECT timestamp, toString(properties.name) AS name, toString(properties.business) AS business, toString(properties.phone) AS phone, toString(properties.email) AS email, toString(properties.hoods) AS hoods, toString(properties.message) AS message FROM events WHERE event = 'quote_submitted' AND toString(properties.source) = 'website_quote_form' ORDER BY timestamp DESC LIMIT 50`,
      ),
    ]);

    const totalsRow = totals.results[0] || [];

    return Response.json({
      configured: true,
      range,
      daily: daily.results.map((r) => ({
        day: String(r[0] ?? ""),
        pageviews: Number(r[1] ?? 0),
        visitors: Number(r[2] ?? 0),
      })),
      totals: {
        pageviews: Number(totalsRow[0] ?? 0),
        visitors: Number(totalsRow[1] ?? 0),
        quotes: Number(totalsRow[2] ?? 0),
        cta_clicks: Number(totalsRow[3] ?? 0),
        completions: Number(totalsRow[4] ?? 0),
      },
      sections: sections.results.map((r) => ({
        section: String(r[0] ?? ""),
        visitors: Number(r[1] ?? 0),
      })),
      devices: devices.results.map((r) => ({
        device: String(r[0] ?? "") || "Unknown",
        visitors: Number(r[1] ?? 0),
      })),
      pages: pages.results.map((r) => ({
        path: String(r[0] ?? ""),
        views: Number(r[1] ?? 0),
      })),
      leads: leads.results.map((r) => ({
        timestamp: String(r[0] ?? ""),
        name: String(r[1] ?? ""),
        business: String(r[2] ?? ""),
        phone: String(r[3] ?? ""),
        email: String(r[4] ?? ""),
        hoods: String(r[5] ?? ""),
        message: String(r[6] ?? ""),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "PostHog query failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
