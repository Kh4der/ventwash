"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const INK = "#1a2129";
const ACCENT = "#3E6FA6";
const ACCENT_SOFT = "#9db8d2";
const BODY = "#414c57";
const MONO = "'IBM Plex Mono',monospace";
const HEAD = "'Archivo',sans-serif";
const CARD_BORDER = "1px solid rgba(26,33,41,.1)";

const RANGES = ["7d", "14d", "30d", "90d"] as const;
type Range = (typeof RANGES)[number];

const SECTION_ORDER = [
  "open",
  "intro",
  "hero",
  "explode",
  "canopy",
  "filters",
  "fire",
  "duct",
  "fan",
  "mua",
  "rebuild",
  "finale",
  "outro",
  "end",
];

interface DailyRow {
  day: string;
  pageviews: number;
  visitors: number;
}
interface Totals {
  pageviews: number;
  visitors: number;
  quotes: number;
  cta_clicks: number;
  completions: number;
}
interface SectionRow {
  section: string;
  visitors: number;
}
interface DeviceRow {
  device: string;
  visitors: number;
}
interface PageRow {
  path: string;
  views: number;
}
interface LeadRow {
  timestamp: string;
  name: string;
  business: string;
  phone: string;
  email: string;
  hoods: string;
  message: string;
}
interface Stats {
  configured: boolean;
  range?: string;
  daily?: DailyRow[];
  totals?: Totals;
  sections?: SectionRow[];
  devices?: DeviceRow[];
  pages?: PageRow[];
  leads?: LeadRow[];
}

function formatLeadTime(ts: string): string {
  const d = new Date(ts.includes("T") || ts.includes("Z") ? ts : ts + "Z");
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  border: CARD_BORDER,
  borderRadius: 8,
  padding: 20,
};

const kickerStyle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: BODY,
  marginBottom: 12,
};

function CardTitle({ children }: { children: React.ReactNode }) {
  return <div style={kickerStyle}>{children}</div>;
}

/* ---------------------------------- pieces --------------------------------- */

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ ...kickerStyle, marginBottom: 10 }}>{label}</div>
      <div
        style={{
          fontFamily: HEAD,
          fontWeight: 800,
          fontSize: 30,
          lineHeight: 1,
          color: INK,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function BarRow({
  label,
  count,
  max,
  sub,
}: {
  label: string;
  count: number;
  max: number;
  sub?: string;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: "0.1em",
            color: INK,
          }}
        >
          {label}
          {sub ? (
            <span style={{ color: BODY, marginLeft: 8 }}>{sub}</span>
          ) : null}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: BODY,
          }}
        >
          {count.toLocaleString()}
        </span>
      </div>
      <div
        style={{
          height: 8,
          background: "#eef3f8",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: pct + "%",
            minWidth: count > 0 ? 3 : 0,
            background: ACCENT,
            borderRadius: 2,
            transition: "width .4s ease",
          }}
        />
      </div>
    </div>
  );
}

function SetupCard() {
  const step: React.CSSProperties = {
    display: "flex",
    gap: 14,
    marginBottom: 18,
    alignItems: "flex-start",
  };
  const num: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: 12,
    color: ACCENT,
    border: "1px solid " + ACCENT,
    borderRadius: 3,
    width: 26,
    height: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  };
  const body: React.CSSProperties = {
    fontSize: 14,
    lineHeight: 1.6,
    color: BODY,
  };
  const code: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: 12,
    background: "#eef3f8",
    padding: "1px 6px",
    borderRadius: 3,
    color: INK,
  };
  return (
    <div style={{ ...cardStyle, maxWidth: 720, padding: 28 }}>
      <div
        style={{
          fontFamily: HEAD,
          fontWeight: 800,
          fontSize: 22,
          color: INK,
          marginBottom: 8,
        }}
      >
        Connect PostHog to see analytics
      </div>
      <p style={{ ...body, marginBottom: 24 }}>
        The dashboard is ready — it just needs PostHog credentials. Follow the
        steps below, then reload this page.
      </p>

      <div style={step}>
        <div style={num}>1</div>
        <div style={body}>
          <strong style={{ color: INK }}>Create a PostHog project.</strong>{" "}
          Sign up free at <span style={code}>posthog.com</span> and create a
          project (US Cloud is the default).
        </div>
      </div>
      <div style={step}>
        <div style={num}>2</div>
        <div style={body}>
          <strong style={{ color: INK }}>Copy the Project API key.</strong>{" "}
          Found in <span style={code}>Settings → Project</span>. It starts with{" "}
          <span style={code}>phc_</span> and is used by the website to send
          events.
        </div>
      </div>
      <div style={step}>
        <div style={num}>3</div>
        <div style={body}>
          <strong style={{ color: INK }}>Create a Personal API key.</strong> In{" "}
          <span style={code}>Settings → Personal API Keys</span>, create a key
          with the <span style={code}>Query Read</span> scope. This lets the
          dashboard read your data. It starts with{" "}
          <span style={code}>phx_</span>.
        </div>
      </div>
      <div style={step}>
        <div style={num}>4</div>
        <div style={body}>
          <strong style={{ color: INK }}>Find your Project ID.</strong> It is
          the number in your PostHog URL:{" "}
          <span style={code}>us.posthog.com/project/12345</span> → the ID is{" "}
          <span style={code}>12345</span>.
        </div>
      </div>
      <div style={step}>
        <div style={num}>5</div>
        <div style={body}>
          <strong style={{ color: INK }}>
            Add the keys to <span style={code}>.env.local</span>
          </strong>{" "}
          at the project root:
          <pre
            style={{
              fontFamily: MONO,
              fontSize: 12,
              background: "#1a2129",
              color: "#c8d6e2",
              borderRadius: 6,
              padding: "14px 16px",
              marginTop: 10,
              overflowX: "auto",
              lineHeight: 1.8,
            }}
          >
            {"NEXT_PUBLIC_POSTHOG_KEY=phc_...\nPOSTHOG_PERSONAL_API_KEY=phx_...\nPOSTHOG_PROJECT_ID=12345"}
          </pre>
        </div>
      </div>
      <div style={step}>
        <div style={num}>6</div>
        <div style={body}>
          <strong style={{ color: INK }}>Restart the dev server</strong> so the
          new environment variables load.
        </div>
      </div>

      <p
        style={{
          ...body,
          marginTop: 6,
          paddingTop: 16,
          borderTop: CARD_BORDER,
          fontSize: 13,
        }}
      >
        Data starts flowing once the site gets its first visits — give it a few
        minutes after the first pageview.
      </p>
    </div>
  );
}

function Skeleton() {
  const block = (h: number): React.CSSProperties => ({
    ...cardStyle,
    height: h,
    background:
      "linear-gradient(90deg,#ffffff 25%,#f0f5f9 50%,#ffffff 75%)",
    backgroundSize: "400% 100%",
    animation: "vwShimmer 1.4s ease infinite",
  });
  return (
    <>
      <style>{`@keyframes vwShimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}`}</style>
      <div className="vw-admin-tiles">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={block(92)} />
        ))}
      </div>
      <div style={{ ...block(320), marginTop: 16 }} />
      <div className="vw-admin-grid" style={{ marginTop: 16 }}>
        <div style={block(280)} />
        <div style={block(280)} />
      </div>
    </>
  );
}

/* --------------------------------- dashboard -------------------------------- */

export default function Dashboard() {
  const [range, setRange] = useState<Range>("14d");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reqIdRef = useRef(0);

  const load = useCallback(async (r: Range) => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/stats?range=" + r, {
        cache: "no-store",
      });
      if (res.status === 401) {
        window.location.href = "/admin/login";
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load stats");
      }
      if (reqId !== reqIdRef.current) return; // stale response — a newer load won
      setStats(data);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [range, load]);

  async function handleLogout() {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } finally {
      window.location.href = "/admin/login";
    }
  }

  const totals = stats?.totals;
  const conversion =
    totals && totals.visitors > 0
      ? ((totals.quotes / totals.visitors) * 100).toFixed(1) + "%"
      : "0%";

  const sectionCounts = new Map(
    (stats?.sections || []).map((s) => [s.section, s.visitors]),
  );
  const sectionMax = Math.max(
    1,
    ...SECTION_ORDER.map((s) => sectionCounts.get(s) || 0),
  );
  const deviceMax = Math.max(1, ...(stats?.devices || []).map((d) => d.visitors));

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f8fb",
        color: INK,
        cursor: "auto",
      }}
    >
      <style>{`
        .vw-admin-tiles{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}
        .vw-admin-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        @media (max-width:900px){
          .vw-admin-tiles{grid-template-columns:1fr 1fr}
          .vw-admin-grid{grid-template-columns:1fr}
          .vw-admin-header{flex-wrap:wrap;gap:12px}
        }
        .vw-admin-table{width:100%;border-collapse:collapse}
        .vw-admin-table th{font-family:${MONO};font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:${BODY};text-align:left;padding:8px 10px;border-bottom:${CARD_BORDER}}
        .vw-admin-table td{font-size:13px;color:${INK};padding:9px 10px;border-bottom:1px solid rgba(26,33,41,.06);vertical-align:top}
        .vw-admin-table tr:last-child td{border-bottom:none}
      `}</style>

      {/* Header */}
      <header
        className="vw-admin-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px",
          background: "#ffffff",
          borderBottom: CARD_BORDER,
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <a
            href="/"
            style={{
              fontFamily: HEAD,
              fontWeight: 800,
              fontSize: 18,
              letterSpacing: "-0.02em",
              color: INK,
              textDecoration: "none",
            }}
          >
            VENT
            <span
              style={{
                fontFamily: "'Instrument Serif',serif",
                fontStyle: "italic",
                fontWeight: 400,
                color: ACCENT,
              }}
            >
              WASH
            </span>
          </a>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: BODY,
            }}
          >
            Analytics
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              display: "flex",
              border: CARD_BORDER,
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  padding: "7px 12px",
                  border: "none",
                  cursor: "pointer",
                  background: r === range ? INK : "#ffffff",
                  color: r === range ? "#f3f8fb" : BODY,
                }}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            onClick={handleLogout}
            style={{
              fontFamily: HEAD,
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: "0.06em",
              padding: "8px 16px",
              border: "none",
              borderRadius: 3,
              background: INK,
              color: "#f3f8fb",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = ACCENT)}
            onMouseLeave={(e) => (e.currentTarget.style.background = INK)}
          >
            LOGOUT
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 64px" }}>
        {error && (
          <div
            style={{
              ...cardStyle,
              borderColor: "rgba(224,138,134,.5)",
              background: "#fdf3f2",
              marginBottom: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  color: "#b04a45",
                  marginBottom: 4,
                }}
              >
                ERROR
              </div>
              <div style={{ fontSize: 13, color: BODY, wordBreak: "break-word" }}>
                {error}
              </div>
            </div>
            <button
              onClick={() => load(range)}
              style={{
                fontFamily: HEAD,
                fontWeight: 700,
                fontSize: 12,
                padding: "8px 16px",
                border: "none",
                borderRadius: 3,
                background: INK,
                color: "#f3f8fb",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              RETRY
            </button>
          </div>
        )}

        {loading && !stats && <Skeleton />}

        {!loading && stats && stats.configured === false && <SetupCard />}

        {stats && stats.configured && totals && (
          <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity .2s" }}>
            {/* Stat tiles */}
            <div className="vw-admin-tiles">
              <StatTile
                label="Unique visitors"
                value={totals.visitors.toLocaleString()}
              />
              <StatTile
                label="Pageviews"
                value={totals.pageviews.toLocaleString()}
              />
              <StatTile
                label="Quote requests"
                value={totals.quotes.toLocaleString()}
              />
              <StatTile
                label="CTA clicks"
                value={totals.cta_clicks.toLocaleString()}
              />
              <StatTile label="Quote conversion" value={conversion} />
            </div>

            {/* Traffic chart */}
            <div style={{ ...cardStyle, marginTop: 16 }}>
              <CardTitle>Traffic — daily visitors &amp; pageviews</CardTitle>
              {stats.daily && stats.daily.length > 0 ? (
                <div style={{ width: "100%", height: 280 }}>
                  <ResponsiveContainer>
                    <AreaChart
                      data={stats.daily}
                      margin={{ top: 8, right: 8, left: -14, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="vwVisitors" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="vwPageviews" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor={ACCENT_SOFT}
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="100%"
                            stopColor={ACCENT_SOFT}
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="rgba(26,33,41,.07)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="day"
                        tick={{ fontFamily: MONO, fontSize: 10, fill: BODY }}
                        tickLine={false}
                        axisLine={{ stroke: "rgba(26,33,41,.15)" }}
                        tickFormatter={(d: string) => d.slice(5)}
                      />
                      <YAxis
                        tick={{ fontFamily: MONO, fontSize: 10, fill: BODY }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          fontFamily: MONO,
                          fontSize: 12,
                          border: CARD_BORDER,
                          borderRadius: 6,
                          background: "#ffffff",
                        }}
                        labelStyle={{ color: INK, fontWeight: 500 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="pageviews"
                        name="Pageviews"
                        stroke={ACCENT_SOFT}
                        strokeWidth={2}
                        fill="url(#vwPageviews)"
                      />
                      <Area
                        type="monotone"
                        dataKey="visitors"
                        name="Visitors"
                        stroke={ACCENT}
                        strokeWidth={2}
                        fill="url(#vwVisitors)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 12,
                    color: BODY,
                    padding: "40px 0",
                    textAlign: "center",
                  }}
                >
                  No traffic yet in this range.
                </div>
              )}
            </div>

            {/* Funnel + devices */}
            <div className="vw-admin-grid" style={{ marginTop: 16 }}>
              <div style={cardStyle}>
                <CardTitle>Scroll story funnel — visitors per section</CardTitle>
                {SECTION_ORDER.map((id, i) => (
                  <BarRow
                    key={id}
                    label={String(i + 1).padStart(2, "0") + " " + id.toUpperCase()}
                    count={sectionCounts.get(id) || 0}
                    max={sectionMax}
                  />
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={cardStyle}>
                  <CardTitle>Devices</CardTitle>
                  {stats.devices && stats.devices.length > 0 ? (
                    stats.devices.map((d) => (
                      <BarRow
                        key={d.device}
                        label={d.device.toUpperCase()}
                        count={d.visitors}
                        max={deviceMax}
                      />
                    ))
                  ) : (
                    <div style={{ fontFamily: MONO, fontSize: 12, color: BODY }}>
                      No device data yet.
                    </div>
                  )}
                </div>

                <div style={cardStyle}>
                  <CardTitle>Top pages</CardTitle>
                  <div style={{ overflowX: "auto" }}>
                    <table className="vw-admin-table">
                      <thead>
                        <tr>
                          <th>Path</th>
                          <th style={{ textAlign: "right" }}>Views</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.pages && stats.pages.length > 0 ? (
                          stats.pages.map((p) => (
                            <tr key={p.path}>
                              <td style={{ fontFamily: MONO, fontSize: 12 }}>
                                {p.path || "/"}
                              </td>
                              <td
                                style={{
                                  textAlign: "right",
                                  fontFamily: MONO,
                                  fontSize: 12,
                                }}
                              >
                                {p.views.toLocaleString()}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td
                              colSpan={2}
                              style={{ fontFamily: MONO, fontSize: 12, color: BODY }}
                            >
                              No pageviews yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Leads */}
            <div style={{ ...cardStyle, marginTop: 16 }}>
              <CardTitle>Quote leads — latest 50</CardTitle>
              {stats.leads && stats.leads.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table className="vw-admin-table" style={{ minWidth: 760 }}>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Name</th>
                        <th>Business</th>
                        <th>Phone</th>
                        <th>Email</th>
                        <th>Hoods</th>
                        <th>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.leads.map((lead, i) => (
                        <tr key={i}>
                          <td
                            style={{
                              fontFamily: MONO,
                              fontSize: 12,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {formatLeadTime(lead.timestamp)}
                          </td>
                          <td style={{ fontWeight: 500 }}>{lead.name}</td>
                          <td>{lead.business}</td>
                          <td style={{ fontFamily: MONO, fontSize: 12 }}>
                            {lead.phone}
                          </td>
                          <td style={{ fontFamily: MONO, fontSize: 12 }}>
                            {lead.email}
                          </td>
                          <td style={{ textAlign: "center" }}>{lead.hoods}</td>
                          <td
                            title={lead.message}
                            style={{ maxWidth: 240, color: BODY }}
                          >
                            {truncate(lead.message, 80)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 12,
                    color: BODY,
                    padding: "28px 0",
                    textAlign: "center",
                  }}
                >
                  No quote requests yet.
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
