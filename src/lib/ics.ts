/**
 * Minimal RFC 5545 VEVENT generator (~60 lines, no dependency). Calendars are
 * projections of the appointments table, never the reverse: UID = appointment
 * id, SEQUENCE bumps on every reschedule so Google/Outlook/Apple update the
 * event in place.
 */

export interface IcsEvent {
  uid: string;
  sequence: number;
  /** ISO-8601 UTC timestamps. */
  startsAt: string;
  endsAt: string;
  summary: string;
  description?: string;
  location?: string;
  method?: "REQUEST" | "CANCEL" | "PUBLISH";
  organizerEmail?: string;
  attendeeEmail?: string;
}

/** 20260715T134500Z */
function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold long content lines at 75 octets (approximated as chars) per RFC 5545 §3.1. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

export function buildIcsEvent(evt: IcsEvent): string {
  const method = evt.method ?? "REQUEST";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VentWash//Scheduling//EN",
    "METHOD:" + method,
    "BEGIN:VEVENT",
    "UID:" + evt.uid + "@ventwash",
    "SEQUENCE:" + evt.sequence,
    "DTSTAMP:" + icsDate(new Date().toISOString()),
    "DTSTART:" + icsDate(evt.startsAt),
    "DTEND:" + icsDate(evt.endsAt),
    "SUMMARY:" + escapeText(evt.summary),
  ];
  if (evt.description) lines.push("DESCRIPTION:" + escapeText(evt.description));
  if (evt.location) lines.push("LOCATION:" + escapeText(evt.location));
  // RFC 5546: a METHOD:REQUEST VEVENT requires an ORGANIZER and at least one
  // ATTENDEE, or strict clients (Outlook, some Google paths) reject it.
  const organizer = evt.organizerEmail || "scheduling@ventwash.com";
  lines.push("ORGANIZER;CN=VentWash:mailto:" + organizer);
  if (method === "REQUEST") {
    const attendee = evt.attendeeEmail || organizer;
    lines.push(
      "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:" +
        attendee,
    );
  }
  lines.push(
    "STATUS:" + (method === "CANCEL" ? "CANCELLED" : "CONFIRMED"),
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** A whole calendar of events (the read-only founder subscribe feed). */
export function buildIcsCalendar(events: IcsEvent[]): string {
  const body = events
    .flatMap((evt) => [
      "BEGIN:VEVENT",
      "UID:" + evt.uid + "@ventwash",
      "SEQUENCE:" + evt.sequence,
      "DTSTAMP:" + icsDate(new Date().toISOString()),
      "DTSTART:" + icsDate(evt.startsAt),
      "DTEND:" + icsDate(evt.endsAt),
      "SUMMARY:" + escapeText(evt.summary),
      ...(evt.location ? ["LOCATION:" + escapeText(evt.location)] : []),
      ...(evt.description ? ["DESCRIPTION:" + escapeText(evt.description)] : []),
      "END:VEVENT",
    ])
    .map(fold);
  return (
    ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//VentWash//Scheduling//EN", ...body, "END:VCALENDAR"].join(
      "\r\n",
    ) + "\r\n"
  );
}
