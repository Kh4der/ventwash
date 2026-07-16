import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { getLead } from "@/lib/leads";
import { transition, IllegalTransitionError, type LeadStatus } from "@/lib/lead-machine";
import { revokeConsent } from "@/lib/compliance/consent";
import { issueOnboardingForm } from "@/lib/onboarding";

/**
 * POST /api/admin/leads/[id]/transition — manual status change through the
 * state machine. Illegal edges surface as 422. A 'do_not_contact' target is
 * NOT a bare transition: the revocation pipeline owns that state, so we call
 * revokeConsent (tier reset, DNC insert, job cancellation, status move in one
 * atomic pipeline) instead.
 */

const STATUSES = new Set<string>([
  "discovered", "enriched", "review_queue", "approved_outreach", "contacting",
  "engaged", "appointment_scheduled", "won_pending_onboarding", "onboarded",
  "inspection_scheduled", "customer", "lost", "do_not_contact",
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  if (!db) return Response.json({ configured: false });

  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = typeof body.to === "string" ? body.to : "";
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!STATUSES.has(to)) {
    return Response.json({ error: "Unknown target status" }, { status: 400 });
  }

  try {
    const lead = await getLead(id);
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });

    if (to === "do_not_contact") {
      await revokeConsent({
        leadId: id,
        phoneE164: lead.phone_e164 ? String(lead.phone_e164) : null,
        channel: "all",
        source: "admin",
        evidence: reason || "admin action",
        actor: "admin",
      });
      return Response.json({ ok: true, from: String(lead.status), to });
    }

    const result = await transition(id, to as LeadStatus, "admin", reason ? { reason } : {});

    // Winning a lead kicks off the onboarding loop: issue the token, send the
    // intake invite, and schedule the T+3d/T+7d nudges. Without this the
    // /onboard flow is unreachable and the lead stalls at won_pending_onboarding.
    if (to === "won_pending_onboarding") {
      try {
        await issueOnboardingForm(id, "admin");
      } catch (e) {
        console.error("[transition] issueOnboardingForm failed for", id, e);
        // The status change stands; surface a hint so the founder can retry.
        return Response.json({
          ok: true,
          from: result.from,
          to: result.to,
          warning: "Lead marked won, but issuing the onboarding invite failed — retry from the lead drawer.",
        });
      }
    }

    return Response.json({ ok: true, from: result.from, to: result.to });
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return Response.json({ error: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "Transition failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
