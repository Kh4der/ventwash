import type { Metadata } from "next";
import Link from "next/link";

/**
 * /privacy — static privacy policy page (Phase 1 launch gate: ships before
 * any outbound message leaves the system). Content is kept honest to what
 * the platform actually does (spec §10.2): consent-tiered contact, STOP/
 * revocation honored immediately, 90-day recording retention, append-only
 * consent/opt-out evidence, deletion with permanent suppression. Counsel
 * review is a Phase 5 launch blocker — the banner below says so.
 */

export const metadata: Metadata = {
  title: "Privacy Policy | VentWash",
  description:
    "How VentWash collects, uses, retains, and protects your information — quotes, scheduling, calls, texts, and your rights to opt out or request deletion.",
};

const MONO = "'IBM Plex Mono',monospace";
const HEAD = "'Archivo',sans-serif";
const SERIF = "'Instrument Serif',serif";
const INK = "#1a2129";
const BLUE = "#3E6FA6";
const BODY = "#414c57";
const BG = "#f3f8fb";
const CARD_BORDER = "1px solid rgba(26,33,41,.1)";

/** Placeholder until the launch mailbox exists — swap before go-live. */
const CONTACT_EMAIL = "privacy@ventwash.example";

const h2Style: React.CSSProperties = {
  fontFamily: HEAD,
  fontWeight: 800,
  fontSize: 19,
  lineHeight: 1.25,
  color: INK,
  margin: "36px 0 10px",
};

const pStyle: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.65,
  margin: "0 0 12px",
};

const ulStyle: React.CSSProperties = {
  margin: "0 0 12px",
  paddingLeft: 22,
};

const liStyle: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.65,
  marginBottom: 6,
};

const linkStyle: React.CSSProperties = {
  color: BLUE,
  textDecoration: "underline",
  textUnderlineOffset: 3,
};

export default function PrivacyPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: BG,
        color: BODY,
        display: "flex",
        justifyContent: "center",
        padding: "56px 20px 88px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 720 }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 12,
            letterSpacing: ".16em",
            color: BLUE,
            marginBottom: 12,
          }}
        >
          VENTWASH PRIVACY
        </div>

        <h1
          style={{
            fontFamily: HEAD,
            fontWeight: 800,
            fontSize: 32,
            lineHeight: 1.15,
            color: INK,
            margin: "0 0 8px",
          }}
        >
          Privacy{" "}
          <span style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: BLUE }}>
            policy
          </span>
        </h1>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 11.5,
            letterSpacing: ".1em",
            color: "#8a94a0",
            marginBottom: 20,
          }}
        >
          LAST UPDATED JULY 2026
        </div>

        <div
          style={{
            background: "#fff",
            border: CARD_BORDER,
            borderLeft: `3px solid ${BLUE}`,
            borderRadius: 6,
            padding: "14px 18px",
            fontFamily: MONO,
            fontSize: 12,
            letterSpacing: ".04em",
            lineHeight: 1.6,
            color: "#5b6570",
            marginBottom: 8,
          }}
        >
          NOTE: This policy is a template pending counsel review.
        </div>

        <h2 style={h2Style}>What we collect</h2>
        <ul style={ulStyle}>
          <li style={liStyle}>
            <strong style={{ color: INK }}>Quote requests.</strong> When you ask
            for a quote we collect what you type into the form: your name,
            business name, phone number, email, hood count, and your message.
          </li>
          <li style={liStyle}>
            <strong style={{ color: INK }}>Calls and texts.</strong> When you
            call us or our automated phone assistant calls you, we keep a record
            of the call and its outcome. Calls are only recorded when the
            recording is disclosed at the start of the call, and transcripts are
            automatically scrubbed of payment-card and Social Security number
            patterns before they are stored.
          </li>
          <li style={liStyle}>
            <strong style={{ color: INK }}>Business contact information.</strong>{" "}
            For business-to-business outreach we may collect contact details
            that your business has publicly listed (for example on your own
            website). We track the exact public source of every address and
            phone number we hold — if you ask where we got your information, we
            can tell you.
          </li>
        </ul>

        <h2 style={h2Style}>Why we use it</h2>
        <p style={pStyle}>
          We use your information to prepare and deliver quotes, to schedule
          and confirm appointments (including reminder emails, texts, and
          calls), and to deliver and document our hood and exhaust cleaning
          services. We do not sell your information, and we do not use it for
          anything unrelated to running this business.
        </p>

        <h2 style={h2Style}>Calls, texts, and your consent</h2>
        <p style={pStyle}>
          Automated or AI-assisted calls and texts from VentWash only happen
          with your consent — for example, after you submit a quote request or
          agree to it on a call. Our phone assistant identifies itself as
          automated at the start of every call.
        </p>
        <p style={pStyle}>You can withdraw consent at any time, by any reasonable means:</p>
        <ul style={ulStyle}>
          <li style={liStyle}>Reply <strong style={{ color: INK }}>STOP</strong> to any text message;</li>
          <li style={liStyle}>Tell the assistant (or any of us) to stop calling during a call;</li>
          <li style={liStyle}>
            Email us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>
              {CONTACT_EMAIL}
            </a>
            ;
          </li>
          <li style={liStyle}>Use the unsubscribe link included in our emails.</li>
        </ul>
        <p style={pStyle}>
          Opt-outs take effect immediately: pending automated contact is
          cancelled and your number or address is added to our internal
          do-not-contact list.
        </p>

        <h2 style={h2Style}>How long we keep it</h2>
        <ul style={ulStyle}>
          <li style={liStyle}>
            Call recordings are deleted within <strong style={{ color: INK }}>90 days</strong>.
          </li>
          <li style={liStyle}>
            Records of your consent and your opt-out requests are kept
            indefinitely — they are the legal evidence that lets us honor your
            choices and prove we did.
          </li>
          <li style={liStyle}>
            Business records (quotes, appointments, service history) are kept
            for as long as we need them to serve you and meet our legal
            obligations.
          </li>
        </ul>

        <h2 style={h2Style}>Who we share it with</h2>
        <p style={pStyle}>
          Only the service providers that make the business run: our telephony
          provider (calls and texts), our email delivery provider, and our
          analytics provider. Each receives only what it needs to do its job.
          We never sell, rent, or trade your information.
        </p>

        <h2 style={h2Style}>Your rights</h2>
        <p style={pStyle}>
          You can ask what information we hold about you, ask where we got it,
          or ask us to delete it — email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>
            {CONTACT_EMAIL}
          </a>
          . We honor deletion requests by removing your personal information
          and permanently suppressing your contact details so our systems can
          never contact you or re-add you again. Consent and opt-out records
          are retained as legal evidence even after deletion.
        </p>

        <h2 style={h2Style}>Contact</h2>
        <p style={pStyle}>
          Questions about this policy or your information:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>

        <div style={{ marginTop: 40, borderTop: CARD_BORDER, paddingTop: 20 }}>
          <Link href="/" style={{ ...linkStyle, fontFamily: MONO, fontSize: 12.5, letterSpacing: ".08em" }}>
            ← VENTWASH HOME
          </Link>
        </div>
      </div>
    </div>
  );
}
