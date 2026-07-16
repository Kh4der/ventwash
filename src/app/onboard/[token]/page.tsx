import type { Metadata } from "next";
import { getFormByToken, markFormOpened } from "@/lib/onboarding";
import { getLead } from "@/lib/leads";
import OnboardingFormClient from "./form-client";

/**
 * /onboard/[token] — customer intake form for won leads. The token is a
 * 128-bit random value verified against its stored sha256 hash
 * (getFormByToken). Invalid, expired, and already-submitted states each get
 * a friendly branded page; a live form marks itself opened and renders the
 * client intake component with only the lead's business name on screen.
 */

export const metadata: Metadata = {
  title: "Onboarding | VentWash",
  robots: { index: false, follow: false },
};

const MONO = "'IBM Plex Mono',monospace";
const HEAD = "'Archivo',sans-serif";
const SERIF = "'Instrument Serif',serif";
const INK = "#1a2129";
const BLUE = "#3E6FA6";
const BODY = "#414c57";
const BG = "#f3f8fb";

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: BG,
        color: BODY,
        display: "flex",
        justifyContent: "center",
        padding: "56px 20px 72px",
      }}
    >
      <div style={{ width: "100%", maxWidth: wide ? 640 : 560 }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 12,
            letterSpacing: ".16em",
            color: BLUE,
            marginBottom: 12,
          }}
        >
          VENTWASH ONBOARDING
        </div>
        {children}
        <div
          style={{
            marginTop: 32,
            fontFamily: MONO,
            fontSize: 10.5,
            letterSpacing: ".1em",
            color: "#8a94a0",
          }}
        >
          LICENSED &amp; INSURED · NFPA 96 CERTIFIED CREWS
        </div>
      </div>
    </div>
  );
}

function Notice({ heading, accent, children }: { heading: string; accent: string; children: React.ReactNode }) {
  return (
    <Shell>
      <h1
        style={{
          fontFamily: HEAD,
          fontWeight: 800,
          fontSize: 28,
          lineHeight: 1.2,
          color: INK,
          margin: "0 0 12px",
        }}
      >
        {heading}{" "}
        <span style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: BLUE }}>
          {accent}
        </span>
        .
      </h1>
      <p style={{ fontSize: 15, lineHeight: 1.6, margin: 0 }}>{children}</p>
    </Shell>
  );
}

export default async function OnboardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const form = await getFormByToken(token);

  if (!form) {
    return (
      <Notice heading="This link is" accent="invalid or has expired">
        Onboarding links are unique to your business and expire for security.
        Reply to our email or give us a call and we&rsquo;ll send you a fresh
        one.
      </Notice>
    );
  }

  if (form.status === "expired") {
    return (
      <Notice heading="This link has" accent="expired">
        Onboarding links are only valid for a limited time. Ask us to resend it
        — reply to our email or give us a call and a new link will be on its
        way.
      </Notice>
    );
  }

  if (form.status === "submitted") {
    return (
      <Notice heading="Already" accent="submitted">
        We have your details — thank you. We&rsquo;ll be in touch shortly about
        your inspection. Nothing else is needed from you right now.
      </Notice>
    );
  }

  await markFormOpened(form.id);
  const lead = await getLead(form.lead_id);
  const businessName = lead ? String(lead.business_name ?? "") : "";

  return (
    <Shell wide>
      <h1
        style={{
          fontFamily: HEAD,
          fontWeight: 800,
          fontSize: 28,
          lineHeight: 1.2,
          color: INK,
          margin: "0 0 6px",
        }}
      >
        Welcome aboard
        {businessName ? (
          <>
            ,{" "}
            <span style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: BLUE }}>
              {businessName}
            </span>
          </>
        ) : null}
        .
      </h1>
      <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: "0 0 24px" }}>
        Tell us about your kitchen so we can plan your first inspection and
        keep you NFPA 96 compliant. Takes about three minutes.
      </p>
      <OnboardingFormClient token={token} />
    </Shell>
  );
}
