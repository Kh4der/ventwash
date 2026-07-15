/**
 * Minimal server-side PostHog HogQL client.
 * Requires POSTHOG_PERSONAL_API_KEY (Query Read scope) and POSTHOG_PROJECT_ID.
 */
export async function runHogQL(
  query: string,
): Promise<{ columns: string[]; results: unknown[][] }> {
  const host = process.env.POSTHOG_API_HOST || "https://us.posthog.com";
  const url =
    host + "/api/projects/" + process.env.POSTHOG_PROJECT_ID + "/query/";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.POSTHOG_PERSONAL_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      "PostHog query failed (" + res.status + "): " + text.slice(0, 300),
    );
  }

  const data = await res.json();
  return { columns: data.columns, results: data.results };
}
