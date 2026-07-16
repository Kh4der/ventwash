/**
 * All outbound email templates — template-literal HTML matching the site's
 * visual grammar (560px card on #f3f8fb, white card, Archivo headings,
 * IBM Plex Mono kickers, #3E6FA6 accents). Every template returns
 * { subject, html }. Every LEAD-DERIVED string is escaped via escapeHtml
 * before interpolation. Customer-facing templates always render the postal
 * address marker div (data-vw-postal="1"); cold_intro additionally renders
 * the CAN-SPAM one-click unsubscribe link and the provenance line — the
 * sendEmail choke point refuses cold sends missing either marker.
 */

const INK = "#1a2129";
const BLUE = "#3E6FA6";
const BODY = "#414c57";
const BG = "#f3f8fb";
const MUTED = "#5b6570";
const FAINT = "#8a94a0";
const RED = "#b23530";
const CARD_BORDER = "1px solid rgba(26,33,41,.1)";
const MONO = "'IBM Plex Mono',Consolas,monospace";
const HEAD = "'Archivo',Arial,Helvetica,sans-serif";
const SANS = "Arial,Helvetica,sans-serif";

/** A lead row as returned by getLead() — untyped DB row, always escape. */
export type LeadLike = Record<string, unknown>;

/** Structural subset of an Appointment (appointments.ts rows satisfy it). */
export interface ApptLike {
  id: string;
  kind: string;
  status: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  location: string;
}

export interface EmailContent {
  subject: string;
  html: string;
}

/** Escape a value for interpolation into HTML. Use on EVERY external string. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "sales_call" → "sales call". */
export function kindLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}

/**
 * Format an ISO instant in the given IANA timezone.
 * "long"  → Tuesday, July 21, 2026, 2:00 PM EDT
 * "short" → Tue, Jul 21, 2:00 PM
 */
export function formatWhen(iso: string, timeZone: string, style: "long" | "short" = "long"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const opts: Intl.DateTimeFormatOptions =
    style === "long"
      ? {
          timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric",
          hour: "numeric", minute: "2-digit", timeZoneName: "short",
        }
      : { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-US", opts).format(date);
  } catch {
    return date.toUTCString();
  }
}

function leadFirstName(lead: LeadLike): string {
  const contact = String(lead.contact_name ?? "").trim();
  if (contact) return contact.split(/\s+/)[0];
  return "";
}

function greeting(lead: LeadLike): string {
  const name = leadFirstName(lead);
  return name ? `Hi ${escapeHtml(name)},` : "Hi,";
}

/** The CAN-SPAM postal marker — rendered in every customer-facing footer. */
function postalBlock(): string {
  const postal = (process.env.BUSINESS_POSTAL_ADDRESS || "").trim() || "[Set BUSINESS_POSTAL_ADDRESS]";
  return `<div data-vw-postal="1" style="font-family:${MONO};font-size:10.5px;letter-spacing:.08em;color:${FAINT};margin-top:8px;">VentWash &middot; ${escapeHtml(postal)}</div>`;
}

function button(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;border-radius:3px;padding:13px 28px;font-family:${MONO};font-size:12.5px;letter-spacing:.1em;text-transform:uppercase;">${escapeHtml(label)}</a>`;
}

/** Mono label / sans value rows for appointment details, digest stats, etc. */
function detailRow(label: string, valueHtml: string): string {
  return `<tr><td style="font-family:${MONO};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};padding:6px 16px 6px 0;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td><td style="font-family:${SANS};font-size:14.5px;line-height:1.5;color:${INK};padding:6px 0;">${valueHtml}</td></tr>`;
}

function detailTable(rows: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;border-collapse:collapse;">${rows}</table>`;
}

interface LayoutOptions {
  kicker: string;
  heading: string;      // trusted HTML built by this module
  bodyHtml: string;     // trusted HTML built by this module
  footerHtml?: string;  // extra footer lines above the postal block
  includePostal?: boolean; // default true (customer-facing); false for internal
}

/** Shared 560px card layout on the site palette. */
function layout(opts: LayoutOptions): string {
  const footerParts: string[] = [];
  if (opts.footerHtml) footerParts.push(opts.footerHtml);
  if (opts.includePostal !== false) footerParts.push(postalBlock());
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG};">
  <div style="padding:32px 16px;background:${BG};">
    <div style="max-width:560px;margin:0 auto;">
      <div style="font-family:${MONO};font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${MUTED};margin:0 0 12px 2px;">VentWash</div>
      <div style="background:#ffffff;border:${CARD_BORDER};border-radius:6px;padding:32px;">
        <div style="font-family:${MONO};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${BLUE};margin:0 0 12px;">${escapeHtml(opts.kicker)}</div>
        <h1 style="font-family:${HEAD};font-weight:800;font-size:24px;line-height:1.2;color:${INK};margin:0 0 14px;">${opts.heading}</h1>
        <div style="font-family:${SANS};font-size:15px;line-height:1.6;color:${BODY};">${opts.bodyHtml}</div>
      </div>
      <div style="margin-top:16px;text-align:center;font-family:${MONO};font-size:10.5px;letter-spacing:.08em;color:${FAINT};">
        ${footerParts.join("\n        ")}
      </div>
    </div>
  </div>
</body>
</html>`;
}

/* ── Customer-facing templates ──────────────────────────────────────────── */

/** "We got your request, expect a call within one business day." */
export function quote_ack(lead: LeadLike): EmailContent {
  const business = String(lead.business_name ?? "").trim();
  const forLine = business ? ` for <strong style="color:${INK};">${escapeHtml(business)}</strong>` : "";
  return {
    subject: "We got your request — expect a call within one business day",
    html: layout({
      kicker: "Request received",
      heading: "We got your request.",
      bodyHtml: `
        <p style="margin:0 0 14px;">${greeting(lead)}</p>
        <p style="margin:0 0 14px;">Thanks for reaching out about hood &amp; exhaust cleaning${forLine}. Your request is in — expect a call from us within <strong style="color:${INK};">one business day</strong> with a firm price.</p>
        <p style="margin:0;">No spam, no obligation. Licensed &amp; insured, NFPA&nbsp;96 certified crews, after-hours scheduling available.</p>`,
      footerHtml: `<div>LICENSED &amp; INSURED &middot; AFTER-HOURS CREWS</div>`,
    }),
  };
}

/** Appointment confirmation with date/time in the appointment timezone. */
export function appointment_confirm(lead: LeadLike, appt: ApptLike, confirmUrl: string): EmailContent {
  const kind = kindLabel(appt.kind);
  const when = formatWhen(appt.starts_at, appt.timezone);
  const rows = [
    detailRow("When", escapeHtml(when)),
    detailRow("What", escapeHtml(`VentWash ${kind}`)),
    appt.location ? detailRow("Where", escapeHtml(appt.location)) : "",
  ].join("");
  return {
    subject: `Your VentWash ${kind} — ${formatWhen(appt.starts_at, appt.timezone, "short")}`,
    html: layout({
      kicker: "Appointment scheduled",
      heading: `Your <span style="color:${BLUE};">${escapeHtml(kind)}</span> is on the books.`,
      bodyHtml: `
        <p style="margin:0 0 14px;">${greeting(lead)}</p>
        <p style="margin:0 0 6px;">Here are the details — a calendar invite is attached.</p>
        ${detailTable(rows)}
        <div style="margin:22px 0 6px;">${button(confirmUrl, "Confirm or manage")}</div>
        <p style="margin:14px 0 0;font-size:13px;color:${MUTED};">Need a different time? Use the link above to confirm, reschedule, or cancel.</p>`,
      footerHtml: `<div>LICENSED &amp; INSURED &middot; NFPA 96 CERTIFIED</div>`,
    }),
  };
}

/** 48-hour reminder — same details, reminder framing. */
export function appointment_reminder_48h(lead: LeadLike, appt: ApptLike, confirmUrl: string): EmailContent {
  const kind = kindLabel(appt.kind);
  const when = formatWhen(appt.starts_at, appt.timezone);
  const rows = [
    detailRow("When", escapeHtml(when)),
    detailRow("What", escapeHtml(`VentWash ${kind}`)),
    appt.location ? detailRow("Where", escapeHtml(appt.location)) : "",
  ].join("");
  return {
    subject: `Reminder: your VentWash ${kind} — ${formatWhen(appt.starts_at, appt.timezone, "short")}`,
    html: layout({
      kicker: "48-hour reminder",
      heading: `Your <span style="color:${BLUE};">${escapeHtml(kind)}</span> is coming up.`,
      bodyHtml: `
        <p style="margin:0 0 14px;">${greeting(lead)}</p>
        <p style="margin:0 0 6px;">A quick heads-up that your appointment is in about two days:</p>
        ${detailTable(rows)}
        <div style="margin:22px 0 6px;">${button(confirmUrl, "Confirm or manage")}</div>
        <p style="margin:14px 0 0;font-size:13px;color:${MUTED};">If the time no longer works, use the link above to reschedule or cancel.</p>`,
      footerHtml: `<div>LICENSED &amp; INSURED &middot; NFPA 96 CERTIFIED</div>`,
    }),
  };
}

/**
 * Onboarding invite. nudge 0 = original invite; 1 and 2 switch to reminder
 * copy (the onboarding_nudge job re-sends this template with nudge set).
 */
export function onboarding_invite(lead: LeadLike, onboardingUrl: string, nudge = 0): EmailContent {
  const business = String(lead.business_name ?? "").trim();
  const businessBit = business ? ` for <strong style="color:${INK};">${escapeHtml(business)}</strong>` : "";

  let subject: string;
  let kicker: string;
  let heading: string;
  let intro: string;
  if (nudge >= 2) {
    subject = "Last reminder — complete your VentWash onboarding";
    kicker = "Final reminder";
    heading = "Your onboarding form is still waiting.";
    intro = `<p style="margin:0 0 14px;">${greeting(lead)}</p>
      <p style="margin:0 0 14px;">One last nudge — we still need a few details${businessBit} before we can schedule your first inspection. It takes about five minutes.</p>`;
  } else if (nudge === 1) {
    subject = "Quick reminder — your VentWash onboarding form";
    kicker = "Reminder";
    heading = "A few details and you're all set.";
    intro = `<p style="margin:0 0 14px;">${greeting(lead)}</p>
      <p style="margin:0 0 14px;">Just a friendly reminder to complete your onboarding form${businessBit} — hood count, access, and scheduling preferences. About five minutes, then we take it from there.</p>`;
  } else {
    subject = "Welcome to VentWash — a few details to get you set up";
    kicker = "Welcome aboard";
    heading = `Welcome to <span style="color:${BLUE};">VentWash</span>.`;
    intro = `<p style="margin:0 0 14px;">${greeting(lead)}</p>
      <p style="margin:0 0 14px;">We're glad to have you${businessBit ? businessBit : ""}. To get your service set up, tell us about your kitchen — hoods, fuel types, roof access, operating hours, and preferred scheduling windows. It takes about five minutes.</p>`;
  }

  return {
    subject,
    html: layout({
      kicker,
      heading,
      bodyHtml: `
        ${intro}
        <div style="margin:22px 0 6px;">${button(onboardingUrl, "Complete onboarding")}</div>
        <p style="margin:14px 0 0;font-size:13px;color:${MUTED};">This link is unique to you and expires after 30 days. Reply to this email if anything is unclear.</p>`,
      footerHtml: `<div>LICENSED &amp; INSURED &middot; NFPA 96 CERTIFIED</div>`,
    }),
  };
}

/** "You're onboarded; we'll confirm your inspection shortly." */
export function onboarding_confirm(lead: LeadLike): EmailContent {
  const business = String(lead.business_name ?? "").trim();
  const businessBit = business ? ` for <strong style="color:${INK};">${escapeHtml(business)}</strong>` : "";
  return {
    subject: "You're onboarded — we'll confirm your inspection shortly",
    html: layout({
      kicker: "Onboarding complete",
      heading: `You're <span style="color:${BLUE};">onboarded</span>.`,
      bodyHtml: `
        <p style="margin:0 0 14px;">${greeting(lead)}</p>
        <p style="margin:0 0 14px;">Thanks — we've received your details${businessBit}. We're lining up your initial inspection now and will confirm the exact date and time shortly.</p>
        <p style="margin:0;">Nothing else is needed from you. If anything changes on your end, just reply to this email.</p>`,
      footerHtml: `<div>LICENSED &amp; INSURED &middot; NFPA 96 CERTIFIED</div>`,
    }),
  };
}

/* ── Cold outreach (CAN-SPAM partials enforced) ─────────────────────────── */

/**
 * Short founder-voiced cold intro. No fake personalization. Must render:
 * the postal marker div, an unsubscribe link containing
 * /api/unsubscribe?token= (caller passes the full URL), and the provenance
 * line naming the public source URL the address was extracted from.
 */
export function cold_intro(lead: LeadLike, unsubscribeUrl: string, sourceUrl: string): EmailContent {
  const business = String(lead.business_name ?? "").trim();
  const businessBit = business ? escapeHtml(business) : "your kitchen";
  const source = escapeHtml(sourceUrl);
  return {
    subject: "Kitchen hood & exhaust cleaning — quick intro from VentWash",
    html: layout({
      kicker: "Hood & exhaust cleaning",
      heading: "A quick intro from VentWash.",
      bodyHtml: `
        <p style="margin:0 0 14px;">Hi — I'm one of the founders of VentWash. We do NFPA&nbsp;96 kitchen hood and exhaust cleaning with after-hours crews, licensed and insured.</p>
        <p style="margin:0 0 14px;">If ${businessBit} is due for a cleaning — or you'd like a second opinion on your current service — reply to this email and I'll handle it personally with a firm quote.</p>
        <p style="margin:0;">No pressure either way. Thanks for reading.</p>`,
      footerHtml: `
        <div style="margin-bottom:6px;">Why you got this: your contact info is listed publicly at <a href="${source}" style="color:${MUTED};">${source}</a>.</div>
        <div style="margin-bottom:6px;">Don't want to hear from us? <a href="${escapeHtml(unsubscribeUrl)}" style="color:${MUTED};">Unsubscribe with one click</a> — no login, no questions.</div>`,
    }),
  };
}

/* ── Internal templates ─────────────────────────────────────────────────── */

/** Internal founder notification when an onboarding form is submitted. */
export function founder_onboarding_notify(lead: LeadLike, dataSummary: Record<string, string>): EmailContent {
  const business = String(lead.business_name ?? "").trim() || "(unnamed lead)";
  const rows = Object.entries(dataSummary)
    .map(([key, value]) => detailRow(key.replace(/_/g, " "), escapeHtml(value)))
    .join("");
  const contactRows = [
    detailRow("Lead", escapeHtml(business)),
    lead.contact_name ? detailRow("Contact", escapeHtml(lead.contact_name)) : "",
    lead.email ? detailRow("Email", escapeHtml(lead.email)) : "",
    lead.phone_e164 ? detailRow("Phone", escapeHtml(lead.phone_e164)) : "",
    detailRow("Lead ID", `<span style="font-family:${MONO};font-size:12px;">${escapeHtml(lead.id)}</span>`),
  ].join("");
  return {
    subject: `[VentWash] Onboarding submitted: ${business}`,
    html: layout({
      kicker: "Internal — onboarding submitted",
      heading: `${escapeHtml(business)} completed onboarding.`,
      bodyHtml: `
        <p style="margin:0 0 6px;">A tentative inspection has been auto-drafted — confirm it from the Appointments panel to fan out reminders.</p>
        ${detailTable(contactRows)}
        <div style="font-family:${MONO};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${BLUE};margin:18px 0 4px;">Submitted details</div>
        ${rows ? detailTable(rows) : `<p style="margin:0;color:${MUTED};">(no fields submitted)</p>`}`,
      includePostal: false,
    }),
  };
}

export interface DigestAppointment {
  startsAt: string;
  timezone: string;
  kind: string;
  status: string;
  businessName: string;
  location: string;
}

export interface DigestStats {
  /** Human date label in the business timezone, e.g. "Wednesday, July 15, 2026". */
  dateLabel: string;
  appointments: DigestAppointment[];
  newLeads24h: number;
  pendingApprovals: number;
  deadJobs: number;
  /** Minutes the oldest DUE pending job has been waiting, or null when queue is clear. */
  oldestDuePendingMin: number | null;
  dnc: { syncedAt: string | null; ageDays: number | null; fresh: boolean };
}

/** The founder daily digest — doubles as the pipeline's dead-man heartbeat. */
export function daily_digest(stats: DigestStats): EmailContent {
  const apptRows = stats.appointments.length
    ? stats.appointments
        .map((a) =>
          detailRow(
            formatWhen(a.startsAt, a.timezone, "short"),
            `${escapeHtml(a.businessName)} — ${escapeHtml(kindLabel(a.kind))} <span style="font-family:${MONO};font-size:11px;color:${MUTED};">[${escapeHtml(a.status)}]</span>${a.location ? `<br><span style="font-size:12.5px;color:${MUTED};">${escapeHtml(a.location)}</span>` : ""}`,
          ),
        )
        .join("")
    : detailRow("—", `<span style="color:${MUTED};">No appointments in the next 24 hours.</span>`);

  const queueStalled = stats.oldestDuePendingMin !== null && stats.oldestDuePendingMin > 15;
  const deadStyle = stats.deadJobs > 0 ? `color:${RED};font-weight:bold;` : `color:${INK};`;

  const warningLines: string[] = [];
  if (stats.deadJobs > 0) {
    warningLines.push(
      `<p style="margin:0 0 6px;font-family:${MONO};font-size:12.5px;color:${RED};">&#9888; ${stats.deadJobs} dead job${stats.deadJobs === 1 ? "" : "s"} in the queue — open the Jobs panel and retry or investigate.</p>`,
    );
  }
  if (queueStalled) {
    warningLines.push(
      `<p style="margin:0 0 6px;font-family:${MONO};font-size:12.5px;color:${RED};">&#9888; Oldest due job has been waiting ~${stats.oldestDuePendingMin} min — the queue may be stalled (is the cron ticking?).</p>`,
    );
  }

  const dncLine = stats.dnc.syncedAt
    ? stats.dnc.fresh
      ? `<span style="color:${INK};">National DNC data synced ${Math.round(stats.dnc.ageDays ?? 0)}d ago — fresh.</span>`
      : `<span style="color:${RED};">National DNC data is STALE (${Math.round(stats.dnc.ageDays ?? 0)}d old) — cold dialing is blocked.</span>`
    : `<span style="color:${RED};">National DNC data has never been synced — cold dialing is blocked.</span>`;

  const statRows = [
    detailRow("New leads (24h)", String(stats.newLeads24h)),
    detailRow("Pending approvals", String(stats.pendingApprovals)),
    detailRow("Dead jobs", `<span style="${deadStyle}">${stats.deadJobs}</span>`),
  ].join("");

  return {
    subject: `VentWash daily digest — ${stats.dateLabel}${stats.deadJobs > 0 ? ` (${stats.deadJobs} dead job${stats.deadJobs === 1 ? "" : "s"})` : ""}`,
    html: layout({
      kicker: "Daily digest",
      heading: escapeHtml(stats.dateLabel),
      bodyHtml: `
        ${warningLines.join("\n        ")}
        <div style="font-family:${MONO};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${BLUE};margin:${warningLines.length ? "14px" : "0"} 0 4px;">Today's appointments</div>
        ${detailTable(apptRows)}
        <div style="font-family:${MONO};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${BLUE};margin:18px 0 4px;">Pipeline</div>
        ${detailTable(statRows)}
        <p style="margin:14px 0 0;font-family:${MONO};font-size:12px;">${dncLine}</p>
        <p style="margin:14px 0 0;font-size:12.5px;color:${MUTED};">This digest is the pipeline heartbeat — if it stops arriving, the worker is down.</p>`,
      includePostal: false,
    }),
  };
}

/** Fields carried on the call_summary job payload (see /api/voice). */
export interface CallSummaryData {
  phone?: string;
  direction?: string;
  outcome?: string | null;
  intent?: string;
  durationS?: number | null;
  name?: string;
  business?: string;
  email?: string;
  address?: string;
  hoods?: string;
  summary?: string | null;
  transcript?: string | null;
  apptKind?: string;
  apptStartsAt?: string;
}

/** Seconds → "m:ss" (125 → "2:05"); null/invalid → "—". */
function formatDurationMmss(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Internal founder notification summarizing a completed AI voice call: a
 * category subject line (booked / emergency / opt-out / quote / callback /
 * new call), the captured business details, the call summary, and the full
 * (already-redacted) transcript in a scrollable monospace block. Every
 * interpolated value is escaped; internal-only, so no unsubscribe/postal.
 */
export function call_summary(data: CallSummaryData): EmailContent {
  const business = String(data.business ?? "").trim();
  const phone = String(data.phone ?? "").trim();
  const intent = String(data.intent ?? "").trim().toLowerCase();
  const outcome = String(data.outcome ?? "").trim().toLowerCase();
  const hasAppt = Boolean(String(data.apptStartsAt ?? "").trim());
  const who = business || phone || "unknown caller";

  let subject: string;
  let category: string;
  if (outcome === "booked" || hasAppt) {
    subject = `[VentWash call] Inspection booked — ${who}`;
    category = "Inspection booked";
  } else if (intent === "emergency") {
    subject = `[VentWash call] ⚠ EMERGENCY — ${who}`;
    category = "⚠ Emergency";
  } else if (outcome === "dnc_request" || outcome === "opt_out") {
    subject = `[VentWash call] Opt-out — ${phone || who}`;
    category = "Opt-out request";
  } else if (intent === "quote" || outcome === "quote_captured") {
    subject = `[VentWash call] Quote request — ${who}`;
    category = "Quote request";
  } else if (intent === "callback" || outcome === "callback_requested") {
    subject = `[VentWash call] Callback requested — ${who}`;
    category = "Callback requested";
  } else {
    subject = `[VentWash call] New call — ${who}`;
    category = "New call";
  }

  const direction = String(data.direction ?? "").trim();
  const rows = [
    detailRow("Caller phone", escapeHtml(phone || "—")),
    data.name ? detailRow("Name", escapeHtml(data.name)) : "",
    business ? detailRow("Business", escapeHtml(business)) : "",
    data.email ? detailRow("Email", escapeHtml(data.email)) : "",
    data.address ? detailRow("Address", escapeHtml(data.address)) : "",
    data.hoods ? detailRow("# Hoods", escapeHtml(data.hoods)) : "",
    intent ? detailRow("Intent", escapeHtml(intent)) : "",
    outcome ? detailRow("Outcome", escapeHtml(outcome)) : "",
    detailRow("Duration", escapeHtml(formatDurationMmss(data.durationS ?? null))),
  ];
  if (hasAppt) {
    const kind = String(data.apptKind ?? "").trim();
    const when = formatWhen(String(data.apptStartsAt), process.env.BUSINESS_TIMEZONE || "America/New_York");
    rows.push(
      detailRow(
        "Booked",
        kind ? `${escapeHtml(kindLabel(kind))} — ${escapeHtml(when)}` : escapeHtml(when),
      ),
    );
  }

  const summaryText = String(data.summary ?? "").trim();
  const transcriptText = String(data.transcript ?? "").trim();
  const directionBit = direction
    ? ` <span style="font-family:${MONO};font-size:12px;color:${MUTED};text-transform:none;letter-spacing:0;">(${escapeHtml(direction)})</span>`
    : "";

  return {
    subject,
    html: layout({
      kicker: "Call summary",
      heading: `${escapeHtml(category)}${directionBit}`,
      bodyHtml: `
        ${detailTable(rows.join(""))}
        <div style="font-family:${MONO};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${BLUE};margin:18px 0 4px;">Summary</div>
        <p style="margin:0;white-space:pre-wrap;">${summaryText ? escapeHtml(summaryText) : "—"}</p>
        <div style="font-family:${MONO};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${BLUE};margin:18px 0 4px;">Transcript</div>
        <pre style="font-family:${MONO};font-size:12px;line-height:1.55;color:${INK};background:${BG};border:${CARD_BORDER};border-radius:4px;padding:14px;max-height:420px;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;">${transcriptText ? escapeHtml(transcriptText) : "No transcript captured."}</pre>`,
      includePostal: false,
    }),
  };
}
