import type { Metadata } from "next";
import { verifyLinkToken } from "@/lib/link-tokens";
import { getAppointment, getAvailableSlots } from "@/lib/appointments";
import { getLead } from "@/lib/leads";
import AppointmentActions from "./actions-client";

/**
 * /appointment/[token] — customer-facing appointment page. The HMAC link
 * token (purpose "appointment") resolves to an appointment id; invalid or
 * expired tokens get a friendly branded error page. Renders minimal PII:
 * business name + the appointment details only. Actions (confirm / cancel /
 * reschedule) live in the client component, which talks to
 * /api/appointments/[token].
 */

export const metadata: Metadata = {
  title: "Your appointment | VentWash",
  robots: { index: false, follow: false },
};

const MONO = "'IBM Plex Mono',monospace";
const HEAD = "'Archivo',sans-serif";
const SERIF = "'Instrument Serif',serif";
const INK = "#1a2129";
const BLUE = "#3E6FA6";
const BODY = "#414c57";
const BG = "#f3f8fb";
const CARD_BORDER = "1px solid rgba(26,33,41,.1)";

const KIND_LABELS: Record<string, string> = {
  sales_call: "Sales call",
  inspection: "On-site inspection",
  cleaning: "Hood & exhaust cleaning",
};

const STATUS_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  tentative: { label: "Awaiting confirmation", color: "#8a6d1a", bg: "rgba(176,141,32,.12)" },
  confirmed: { label: "Confirmed", color: "#2e6b3f", bg: "rgba(46,107,63,.12)" },
  rescheduled: { label: "Rescheduled", color: BLUE, bg: "rgba(62,111,166,.12)" },
  completed: { label: "Completed", color: "#2e6b3f", bg: "rgba(46,107,63,.12)" },
  cancelled: { label: "Cancelled", color: "#b23530", bg: "rgba(178,53,48,.1)" },
  no_show: { label: "Missed", color: "#5b6570", bg: "rgba(26,33,41,.08)" },
};

function formatInTz(iso: string, timeZone: string, opts: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(d);
  }
}

function Shell({ children }: { children: React.ReactNode }) {
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
      <div style={{ width: "100%", maxWidth: 560 }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 12,
            letterSpacing: ".16em",
            color: BLUE,
            marginBottom: 12,
          }}
        >
          VENTWASH SCHEDULING
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

function InvalidLink() {
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
        This link is{" "}
        <span style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: BLUE }}>
          invalid or has expired
        </span>
        .
      </h1>
      <p style={{ fontSize: 15, lineHeight: 1.6, margin: 0 }}>
        Appointment links expire for security. If you need to confirm, move, or
        cancel your appointment, reply to your confirmation email or give us a
        call and we&rsquo;ll send you a fresh link.
      </p>
    </Shell>
  );
}

export default async function AppointmentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const appointmentId = verifyLinkToken("appointment", token);
  if (!appointmentId) return <InvalidLink />;

  const appt = await getAppointment(appointmentId);
  if (!appt) return <InvalidLink />;

  const lead = await getLead(appt.lead_id);
  const businessName = lead ? String(lead.business_name ?? "") : "";

  const dateLabel = formatInTz(appt.starts_at, appt.timezone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeLabel =
    formatInTz(appt.starts_at, appt.timezone, { hour: "numeric", minute: "2-digit" }) +
    " – " +
    formatInTz(appt.ends_at, appt.timezone, {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });

  const badge = STATUS_BADGES[appt.status] ?? STATUS_BADGES.tentative;

  // Up to 6 reschedule options, pre-formatted in the appointment's timezone
  // so the client component stays presentation-only.
  const slots = (await getAvailableSlots(14)).slice(0, 6).map((s) => ({
    startsAt: s.startsAt,
    label: formatInTz(s.startsAt, appt.timezone, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }),
  }));

  const rowLabel: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: ".14em",
    color: "#5b6570",
    marginBottom: 4,
  };

  return (
    <Shell>
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
        {KIND_LABELS[appt.kind] ?? "Appointment"}
        {businessName ? (
          <>
            {" "}
            for{" "}
            <span style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, color: BLUE }}>
              {businessName}
            </span>
          </>
        ) : null}
      </h1>
      <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: "0 0 20px" }}>
        Review your appointment below — you can confirm it, pick a different
        time, or cancel.
      </p>

      <div
        style={{
          background: "#fff",
          border: CARD_BORDER,
          borderRadius: 8,
          padding: 24,
        }}
      >
        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <div style={rowLabel}>When</div>
            <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 18, color: INK }}>
              {dateLabel}
            </div>
            <div style={{ fontSize: 15, color: BODY, marginTop: 2 }}>{timeLabel}</div>
          </div>

          {appt.location ? (
            <div>
              <div style={rowLabel}>Location</div>
              <div style={{ fontSize: 15, color: INK }}>{appt.location}</div>
            </div>
          ) : null}

          <div>
            <div style={rowLabel}>Status</div>
            <span
              style={{
                display: "inline-block",
                fontFamily: MONO,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: ".1em",
                color: badge.color,
                background: badge.bg,
                border: `1px solid ${badge.color}33`,
                borderRadius: 3,
                padding: "4px 10px",
              }}
            >
              {badge.label}
            </span>
          </div>
        </div>

        <AppointmentActions
          token={token}
          status={appt.status}
          startsAt={appt.starts_at}
          slots={slots}
        />
      </div>
    </Shell>
  );
}
