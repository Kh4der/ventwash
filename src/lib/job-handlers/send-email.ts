import type { Job } from "@/lib/jobs";
import type { HandlerResult } from "@/lib/job-handlers";
import { q, qOne, nowIso } from "@/lib/db";
import { getLead } from "@/lib/leads";
import { getAppointment, businessTimezone } from "@/lib/appointments";
import { sendEmail } from "@/lib/email/send";
import * as templates from "@/lib/email/templates";
import { buildIcsEvent } from "@/lib/ics";
import { createLinkToken, siteBaseUrl } from "@/lib/link-tokens";
import { dncFreshness } from "@/lib/compliance/dnc";

/**
 * send_email job handler — renders a template and hands the result to the
 * sendEmail choke point (the ONLY code that talks to Resend). Dispatches on
 * payload.template; appointment templates re-validate appointment state at
 * send time (a cancelled/completed appointment makes the reminder stale and
 * the job completes as a no-op). Cold intros resolve their recipient from
 * provenanced contact_points rows — the choke point re-asserts provenance.
 *
 * Payload contract: { template, leadId?, appointmentId?, onboardingUrl?,
 * nudge?, contactEmail? } + job.lead_id.
 */

const APPOINTMENT_LINK_TTL_MS = 14 * 24 * 3600_000;
const UNSUBSCRIBE_LINK_TTL_MS = 90 * 24 * 3600_000;

/** Map a choke-point result onto the job handler contract. */
export function mapSendResult(result: {
  status: "sent" | "blocked" | "skipped_unconfigured";
  blockReason?: string;
}): HandlerResult {
  if (result.status === "blocked") return { blocked: result.blockReason ?? "blocked" };
  if (result.status === "skipped_unconfigured") return { simulated: true };
  return undefined; // sent
}

/** Customer-facing confirm/manage URL for an appointment (14-day token). */
export function appointmentManageUrl(appointmentId: string): string {
  const token = createLinkToken("appointment", appointmentId, APPOINTMENT_LINK_TTL_MS);
  return token ? `${siteBaseUrl()}/appointment/${token}` : siteBaseUrl();
}

function payloadString(job: Job, key: string): string {
  const v = job.payload[key];
  return typeof v === "string" ? v : "";
}

export async function run(job: Job): Promise<HandlerResult> {
  const template = String(job.payload.template ?? "");
  if (template === "daily_digest") return runDailyDigest(job);
  if (template === "call_summary") return runCallSummary(job);

  const leadId = job.lead_id ?? (payloadString(job, "leadId") || null);
  if (!leadId) throw new Error(`send_email(${template}) requires a lead id`);
  const lead = await getLead(leadId);
  if (!lead) return; // deleted (or never existed) — nothing to send, job done

  const to = String(lead.email ?? "");

  switch (template) {
    case "quote_ack": {
      const t = templates.quote_ack(lead);
      return mapSendResult(
        await sendEmail({ leadId, jobId: job.id, kind: "transactional", template, to, ...t }),
      );
    }

    case "appointment_confirm":
    case "appointment_reminder_48h": {
      const appointmentId = payloadString(job, "appointmentId");
      const appt = appointmentId ? await getAppointment(appointmentId) : null;
      if (!appt) return; // appointment gone — stale job
      if (appt.status === "cancelled" || appt.status === "completed") return; // stale reminder
      const manageUrl = appointmentManageUrl(appt.id);

      if (template === "appointment_confirm") {
        const t = templates.appointment_confirm(lead, appt, manageUrl);
        const ics = buildIcsEvent({
          uid: appt.id,
          sequence: appt.ics_sequence,
          startsAt: appt.starts_at,
          endsAt: appt.ends_at,
          summary: `VentWash ${templates.kindLabel(appt.kind)}`,
          description: `Manage this appointment: ${manageUrl}`,
          location: appt.location || undefined,
        });
        return mapSendResult(
          await sendEmail({
            leadId, jobId: job.id, kind: "transactional", template, to, ...t,
            attachments: [
              { filename: "appointment.ics", content: Buffer.from(ics, "utf8").toString("base64") },
            ],
          }),
        );
      }

      const t = templates.appointment_reminder_48h(lead, appt, manageUrl);
      return mapSendResult(
        await sendEmail({ leadId, jobId: job.id, kind: "transactional", template, to, ...t }),
      );
    }

    case "onboarding_invite": {
      const onboardingUrl = payloadString(job, "onboardingUrl");
      if (!onboardingUrl) throw new Error("onboarding_invite requires payload.onboardingUrl");
      const nudge = Number(job.payload.nudge ?? 0) || 0;
      const t = templates.onboarding_invite(lead, onboardingUrl, nudge);
      return mapSendResult(
        await sendEmail({ leadId, jobId: job.id, kind: "transactional", template, to, ...t }),
      );
    }

    case "onboarding_confirm": {
      const t = templates.onboarding_confirm(lead);
      return mapSendResult(
        await sendEmail({ leadId, jobId: job.id, kind: "transactional", template, to, ...t }),
      );
    }

    case "founder_onboarding_notify": {
      const founder = process.env.FOUNDER_EMAIL;
      if (!founder) {
        console.log("[dev no-op] founder_onboarding_notify: FOUNDER_EMAIL unset — skipping");
        return { simulated: true };
      }
      const form = await qOne({
        sql: "SELECT data FROM onboarding_forms WHERE lead_id = ?",
        args: [leadId],
      });
      let dataSummary: Record<string, string> = {};
      try {
        const parsed = form?.data ? JSON.parse(String(form.data)) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === "string") dataSummary[k.slice(0, 100)] = v.slice(0, 2000);
          }
        }
      } catch {
        dataSummary = {};
      }
      const t = templates.founder_onboarding_notify(lead, dataSummary);
      return mapSendResult(
        await sendEmail({ leadId, jobId: job.id, kind: "internal", template, to: founder, ...t }),
      );
    }

    case "cold_intro": {
      // Recipient MUST come from a provenanced contact_points row. An optional
      // payload.contactEmail override still has to exist there — the choke
      // point re-asserts this, but we also need the row for source_url.
      const override = payloadString(job, "contactEmail").trim().toLowerCase();
      const row = override
        ? await qOne({
            sql: "SELECT value, source_url FROM contact_points WHERE lead_id = ? AND kind = 'email' AND value = ?",
            args: [leadId, override],
          })
        : await qOne({
            sql: "SELECT value, source_url FROM contact_points WHERE lead_id = ? AND kind = 'email' ORDER BY extracted_at ASC LIMIT 1",
            args: [leadId],
          });
      if (!row) return { blocked: "no_provenance" };
      const coldTo = String(row.value);
      const sourceUrl = String(row.source_url ?? "");

      const token = createLinkToken("unsubscribe", leadId, UNSUBSCRIBE_LINK_TTL_MS);
      if (!token) return { blocked: "link_secret_unconfigured" }; // no working unsubscribe ⇒ no cold send
      const unsubscribeUrl = `${siteBaseUrl()}/api/unsubscribe?token=${token}`;

      const t = templates.cold_intro(lead, unsubscribeUrl, sourceUrl);
      return mapSendResult(
        await sendEmail({ leadId, jobId: job.id, kind: "cold", template, to: coldTo, ...t }),
      );
    }

    default:
      throw new Error(`send_email: unknown template '${template}'`);
  }
}

/**
 * The founder daily digest — shared by the send_email('daily_digest') path
 * and the daily_digest job type (daily-digest.ts delegates here). Computes
 * today's stats from the DB, renders, and sends to FOUNDER_EMAIL (unset ⇒
 * simulated no-op so dev pipelines stay green).
 */
export async function runDailyDigest(job: Job): Promise<HandlerResult> {
  const now = Date.now();
  const nowStr = nowIso();
  const dayEnd = new Date(now + 24 * 3600_000).toISOString();
  const dayAgo = new Date(now - 24 * 3600_000).toISOString();

  const apptRows = await q({
    sql: `SELECT a.starts_at, a.timezone, a.kind, a.status, a.location, l.business_name
          FROM appointments a LEFT JOIN leads l ON l.id = a.lead_id
          WHERE a.status IN ('tentative','confirmed','rescheduled')
            AND a.starts_at >= ? AND a.starts_at < ?
          ORDER BY a.starts_at ASC LIMIT 50`,
    args: [nowStr, dayEnd],
  });
  const newLeads = await qOne({
    sql: "SELECT COUNT(*) AS n FROM leads WHERE created_at >= ? AND deleted_at IS NULL",
    args: [dayAgo],
  });
  const pendingApprovals = await qOne(
    "SELECT COUNT(*) AS n FROM leads WHERE approval = 'pending' AND deleted_at IS NULL",
  );
  const deadJobs = await qOne("SELECT COUNT(*) AS n FROM jobs WHERE status = 'dead'");
  const oldestDue = await qOne({
    sql: "SELECT MIN(run_at) AS r FROM jobs WHERE status = 'pending' AND run_at <= ?",
    args: [nowStr],
  });

  let oldestDuePendingMin: number | null = null;
  if (oldestDue?.r) {
    const t = new Date(String(oldestDue.r)).getTime();
    if (Number.isFinite(t)) oldestDuePendingMin = Math.max(0, Math.round((now - t) / 60_000));
  }

  let dateLabel: string;
  try {
    dateLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: businessTimezone(),
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    }).format(new Date());
  } catch {
    dateLabel = nowStr.slice(0, 10);
  }

  const stats: templates.DigestStats = {
    dateLabel,
    appointments: apptRows.map((r) => ({
      startsAt: String(r.starts_at),
      timezone: String(r.timezone ?? businessTimezone()),
      kind: String(r.kind ?? ""),
      status: String(r.status ?? ""),
      businessName: String(r.business_name ?? "(unknown)"),
      location: String(r.location ?? ""),
    })),
    newLeads24h: Number(newLeads?.n ?? 0),
    pendingApprovals: Number(pendingApprovals?.n ?? 0),
    deadJobs: Number(deadJobs?.n ?? 0),
    oldestDuePendingMin,
    dnc: await dncFreshness(),
  };

  const founder = process.env.FOUNDER_EMAIL;
  if (!founder) {
    console.log(
      `[dev no-op] daily_digest: FOUNDER_EMAIL unset — digest not sent (appointments=${stats.appointments.length}, newLeads=${stats.newLeads24h}, deadJobs=${stats.deadJobs})`,
    );
    return { simulated: true };
  }

  const t = templates.daily_digest(stats);
  return mapSendResult(
    await sendEmail({ jobId: job.id, kind: "internal", template: "daily_digest", to: founder, ...t }),
  );
}

/**
 * Founder call-summary notification — fires once per AI voice call. The whole
 * call payload rides on the job (a call may lack a full lead, so this skips
 * the leadId-required check in run()). FOUNDER_EMAIL unset ⇒ simulated no-op
 * so dev pipelines stay green.
 */
async function runCallSummary(job: Job): Promise<HandlerResult> {
  const founder = process.env.FOUNDER_EMAIL;
  if (!founder) {
    console.log("[dev no-op] call_summary: FOUNDER_EMAIL unset — skipping");
    return { simulated: true };
  }
  const t = templates.call_summary(job.payload as templates.CallSummaryData);
  return mapSendResult(
    await sendEmail({
      leadId: job.lead_id ?? undefined,
      jobId: job.id,
      kind: "internal",
      template: "call_summary",
      to: founder,
      ...t,
    }),
  );
}
