/**
 * /bot — public crawler transparency page (spec D16). Linked from
 * VentWashLeadBot's User-Agent string so any site operator who sees us in
 * their logs can learn who we are, what we do, what we respect, and how to
 * opt out. Server component, site-styled (inline styles, site constants).
 */

import type { Metadata } from "next";

const MONO = "'IBM Plex Mono',monospace";
const HEAD = "'Archivo',sans-serif";
const INK = "#1a2129";
const BODY = "#414c57";
const BLUE = "#3E6FA6";
const CARD_BORDER = "1px solid rgba(26,33,41,.1)";
const OPT_OUT_EMAIL = "iamfarzaad@gmail.com";

export const metadata: Metadata = {
  title: "VentWashLeadBot — Crawler Transparency | VentWash",
  description:
    "Who the VentWash website crawler is, what it reads, what it respects (robots.txt, crawl delays), and how to opt out.",
};

const sectionCard: React.CSSProperties = {
  background: "#ffffff",
  border: CARD_BORDER,
  borderRadius: 8,
  padding: "20px 24px",
  marginBottom: 16,
};

const kicker: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: BLUE,
  marginBottom: 8,
};

const heading: React.CSSProperties = {
  fontFamily: HEAD,
  fontWeight: 700,
  fontSize: 18,
  color: INK,
  margin: "0 0 10px",
};

const para: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 13,
  lineHeight: 1.7,
  color: BODY,
  margin: "0 0 10px",
};

export default function BotPage() {
  return (
    <main style={{ background: "#f3f8fb", minHeight: "100vh", padding: "48px 20px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={kicker}>Crawler transparency</div>
        <h1
          style={{
            fontFamily: HEAD,
            fontWeight: 800,
            fontSize: 32,
            color: INK,
            margin: "0 0 8px",
          }}
        >
          VentWashLeadBot
        </h1>
        <p style={{ ...para, marginBottom: 28 }}>
          If this bot showed up in your server logs, this page explains everything it does — and
          how to make it stop.
        </p>

        <section style={sectionCard}>
          <h2 style={heading}>Who we are</h2>
          <p style={para}>
            VentWashLeadBot is the website crawler of VentWash, a commercial kitchen hood and
            exhaust cleaning company (NFPA 96 compliance cleaning). It identifies itself honestly
            on every request with a User-Agent that links back to this page:
          </p>
          <p
            style={{
              ...para,
              background: "#f3f8fb",
              border: CARD_BORDER,
              borderRadius: 6,
              padding: "10px 14px",
              margin: 0,
              wordBreak: "break-all",
            }}
          >
            VentWashLeadBot/1.0 (+https://ventwash.example/bot)
          </p>
        </section>

        <section style={sectionCard}>
          <h2 style={heading}>What it does</h2>
          <p style={para}>
            It reads publicly available restaurant-website pages — mainly contact and about pages
            — to find the business phone number or email published there, so we can invite the
            business to a kitchen-hood cleaning quote. That is the entire job. It never submits
            forms, never creates accounts, never logs in, and never accesses anything a normal
            anonymous visitor could not see.
          </p>
        </section>

        <section style={sectionCard}>
          <h2 style={heading}>What it respects</h2>
          <ul style={{ ...para, paddingLeft: 20, margin: 0 }}>
            <li>
              <strong style={{ color: INK }}>robots.txt</strong> — fully honored. If we cannot
              parse your robots.txt, we treat it as &quot;disallow everything&quot; and do not
              crawl at all.
            </li>
            <li>
              <strong style={{ color: INK }}>Crawl-delay</strong> — honored, with a minimum of 3
              seconds between requests to your site regardless.
            </li>
            <li>
              <strong style={{ color: INK }}>Small footprint</strong> — at most 10 pages per site,
              8-second timeouts, one request at a time.
            </li>
            <li>
              <strong style={{ color: INK }}>No logins, no paywalls, no CAPTCHAs</strong> — the
              crawler has no code for any of them. If your site answers 401, 403, or 429, or shows
              a CAPTCHA, we mark your domain as off-limits and never return.
            </li>
            <li>
              <strong style={{ color: INK }}>Anti-harvest signals</strong> — addresses marked
              &quot;no spam&quot; or &quot;not for solicitation&quot;, or deliberately obfuscated,
              are skipped and never stored.
            </li>
            <li>
              <strong style={{ color: INK }}>Full audit trail</strong> — every fetch we make is
              logged, permanently.
            </li>
          </ul>
        </section>

        <section style={sectionCard}>
          <h2 style={heading}>How to opt out</h2>
          <p style={para}>
            Email{" "}
            <a href={`mailto:${OPT_OUT_EMAIL}`} style={{ color: BLUE }}>
              {OPT_OUT_EMAIL}
            </a>{" "}
            with your domain and we will honor it immediately: your domain goes on a permanent
            do-not-crawl list, and any contact details we extracted from your site are deleted on
            request. Adding <span style={{ color: INK }}>VentWashLeadBot</span> to your robots.txt
            disallow rules works too — we check it before every crawl.
          </p>
        </section>

        <p style={{ ...para, fontSize: 12, marginTop: 24 }}>
          Business locations ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            style={{ color: BLUE }}
            rel="noreferrer"
          >
            OpenStreetMap contributors
          </a>
          .
        </p>
      </div>
    </main>
  );
}
