/**
 * scripts/verify-voice-config.ts — `npm run verify:voice-config`
 *
 * Diffs the LIVE Vapi assistant configuration against the repo canon in
 * src/lib/voice/scripts.ts (spec D21 / §6.1): the disclosure firstMessage
 * must match EXACTLY, the recording setting must match RECORDING_ENABLED,
 * and the outbound assistant may expose only the four approved tools
 * (no price/contract tool exists by design). CI gate: exits 1 on any drift.
 *
 * Unconfigured environments (no VAPI_API_KEY or no assistant ids) skip
 * cleanly so local dev and forks stay green. Run with:
 *   npx tsx scripts/verify-voice-config.ts
 */

import {
  INBOUND_FIRST_MESSAGE,
  OUTBOUND_FIRST_MESSAGE,
  RECORDING_DISCLOSURE,
  SCRIPTS_VERSION,
} from "../src/lib/voice/scripts";

const VAPI_BASE = "https://api.vapi.ai";

const ALLOWED_OUTBOUND_TOOLS = new Set([
  "check_availability",
  "book_appointment",
  "mark_dnc",
  "request_callback",
]);

const apiKey = process.env.VAPI_API_KEY;
const inboundId = process.env.VAPI_ASSISTANT_INBOUND_ID;
const outboundId = process.env.VAPI_ASSISTANT_OUTBOUND_ID;
const recordingOn = process.env.RECORDING_ENABLED === "1";

function expectedFirstMessage(canon: string): string {
  return recordingOn ? canon + " " + RECORDING_DISCLOSURE : canon;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

async function fetchAssistant(id: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${VAPI_BASE}/assistant/${encodeURIComponent(id)}`, {
    headers: { Authorization: "Bearer " + apiKey },
  });
  if (!res.ok) {
    throw new Error(`GET /assistant/${id} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const data: unknown = await res.json();
  if (!isObject(data)) throw new Error(`GET /assistant/${id} returned a non-object body`);
  return data;
}

/** Vapi's recording flag has lived in two places; default is ON at Vapi. */
function liveRecordingEnabled(assistant: Record<string, unknown>): boolean {
  const artifactPlan = assistant.artifactPlan;
  if (isObject(artifactPlan) && typeof artifactPlan.recordingEnabled === "boolean") {
    return artifactPlan.recordingEnabled;
  }
  if (typeof assistant.recordingEnabled === "boolean") return assistant.recordingEnabled;
  return true; // Vapi default
}

/** Tool names from model.tools — function name, else the built-in tool type. */
function liveToolNames(assistant: Record<string, unknown>): string[] {
  const model = assistant.model;
  if (!isObject(model) || !Array.isArray(model.tools)) return [];
  return model.tools.map((t: unknown) => {
    if (!isObject(t)) return "(malformed tool)";
    const fn = t.function;
    if (isObject(fn) && typeof fn.name === "string") return fn.name;
    return typeof t.type === "string" ? `(builtin:${t.type})` : "(unnamed tool)";
  });
}

interface Mismatch {
  assistant: string;
  field: string;
  expected: string;
  actual: string;
}

async function verifyAssistant(
  label: "inbound" | "outbound",
  id: string,
  canonFirstMessage: string,
): Promise<Mismatch[]> {
  const mismatches: Mismatch[] = [];
  const assistant = await fetchAssistant(id);

  const expectedMsg = expectedFirstMessage(canonFirstMessage);
  const actualMsg = typeof assistant.firstMessage === "string" ? assistant.firstMessage : "";
  if (actualMsg !== expectedMsg) {
    mismatches.push({ assistant: label, field: "firstMessage", expected: expectedMsg, actual: actualMsg });
  }

  const liveRecording = liveRecordingEnabled(assistant);
  if (liveRecording !== recordingOn) {
    mismatches.push({
      assistant: label,
      field: "recording",
      expected: recordingOn ? "enabled (RECORDING_ENABLED=1)" : "disabled (RECORDING_ENABLED unset)",
      actual: liveRecording ? "enabled" : "disabled",
    });
  }

  if (label === "outbound") {
    const names = liveToolNames(assistant);
    const extras = names.filter((n) => !ALLOWED_OUTBOUND_TOOLS.has(n));
    if (extras.length) {
      mismatches.push({
        assistant: label,
        field: "tools",
        expected: `subset of {${[...ALLOWED_OUTBOUND_TOOLS].join(", ")}}`,
        actual: names.join(", ") || "(none)",
      });
    }
  }

  return mismatches;
}

async function main(): Promise<void> {
  if (!apiKey || (!inboundId && !outboundId)) {
    console.log("SKIP (unconfigured)");
    process.exit(0);
  }

  console.log(`verify-voice-config: scripts version ${SCRIPTS_VERSION}, recording ${recordingOn ? "ON" : "OFF"}`);

  const targets: { label: "inbound" | "outbound"; id: string; canon: string }[] = [];
  if (inboundId) targets.push({ label: "inbound", id: inboundId, canon: INBOUND_FIRST_MESSAGE });
  if (outboundId) targets.push({ label: "outbound", id: outboundId, canon: OUTBOUND_FIRST_MESSAGE });

  const mismatches: Mismatch[] = [];
  for (const t of targets) {
    try {
      mismatches.push(...(await verifyAssistant(t.label, t.id, t.canon)));
    } catch (err) {
      mismatches.push({
        assistant: t.label,
        field: "fetch",
        expected: "assistant retrievable from Vapi",
        actual: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (mismatches.length) {
    console.error(`\nFAIL — ${mismatches.length} mismatch(es) between live Vapi config and repo canon:\n`);
    for (const m of mismatches) {
      console.error(`MISMATCH [${m.assistant}] ${m.field}`);
      console.error(`  expected: ${JSON.stringify(m.expected)}`);
      console.error(`  actual:   ${JSON.stringify(m.actual)}\n`);
    }
    process.exit(1);
  }

  console.log(`OK — ${targets.map((t) => t.label).join(" + ")} assistant config matches repo canon.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("verify-voice-config crashed:", err);
  process.exit(1);
});
