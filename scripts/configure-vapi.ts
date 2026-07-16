// Configures the Vapi inbound assistant from repo canon (scripts.ts) via the
// Vapi API. Idempotent — re-run any time to re-sync. Reads keys from .env.local.
//
//   npx tsx scripts/configure-vapi.ts <assistantId>
//
// Model starts on OpenAI (works on Vapi trial credits) so we can test the whole
// pipeline today; flip MODEL_* to Anthropic/Claude once the Anthropic key is
// added to Vapi's integration.
import fs from "node:fs";
import path from "node:path";
import { INBOUND_SYSTEM_PROMPT, INBOUND_FIRST_MESSAGE } from "../src/lib/voice/scripts";

const MODEL_PROVIDER = "openai";
const MODEL_NAME = "gpt-4.1";

function loadEnv() {
  for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    if (!(t.slice(0, i) in process.env)) process.env[t.slice(0, i)] = t.slice(i + 1);
  }
}

async function main() {
  loadEnv();
  const KEY = process.env.VAPI_API_KEY!;
  const SECRET = process.env.VAPI_WEBHOOK_SECRET!;
  const SITE = process.env.SITE_BASE_URL || "https://ventwash.com";
  const assistantId = process.argv[2];
  if (!assistantId) throw new Error("Usage: configure-vapi.ts <assistantId>");

  const toolServer = { url: `${SITE}/api/vapi/tools`, secret: SECRET };
  const tools = [
    {
      type: "function", async: false, server: toolServer,
      function: {
        name: "check_availability",
        description: "Get the next open appointment slots. Returns human-readable times each with an ISO timestamp. Call before booking.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function", async: false, server: toolServer,
      function: {
        name: "book_appointment",
        description: "Tentatively book an appointment at an open slot. Use an ISO timestamp returned by check_availability. Our team confirms afterward.",
        parameters: {
          type: "object",
          properties: {
            startsAt: { type: "string", description: "ISO-8601 start time from check_availability, e.g. 2026-07-21T14:00:00.000Z" },
            kind: { type: "string", enum: ["sales_call", "inspection"], description: "Type of visit; defaults to sales_call" },
          },
          required: ["startsAt"],
        },
      },
    },
    {
      type: "function", async: false, server: toolServer,
      function: {
        name: "mark_dnc",
        description: "Record that the caller does not want to be contacted again. Use immediately if they ask to stop calls/texts.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function", async: false, server: toolServer,
      function: {
        name: "request_callback",
        description: "Log a request for a human callback at the caller's preferred time.",
        parameters: {
          type: "object",
          properties: { preferredTime: { type: "string", description: "Caller's preferred callback window, e.g. 'tomorrow morning'" } },
          required: ["preferredTime"],
        },
      },
    },
  ];

  const body = {
    name: "VentWash Inbound",
    firstMessage: INBOUND_FIRST_MESSAGE,
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: MODEL_PROVIDER,
      model: MODEL_NAME,
      temperature: 0.6,
      maxTokens: 250,
      messages: [{ role: "system", content: INBOUND_SYSTEM_PROMPT }],
      tools,
    },
    server: { url: `${SITE}/api/voice`, secret: SECRET },
    serverMessages: ["status-update", "end-of-call-report"],
    analysisPlan: {
      summaryPlan: { enabled: true },
      structuredDataPlan: {
        enabled: true,
        schema: {
          type: "object",
          properties: {
            name: { type: "string", description: "caller's full name" },
            business: { type: "string", description: "the business name" },
            email: { type: "string", description: "caller's email address, lowercased" },
            phone: { type: "string", description: "caller's phone number" },
            address: { type: "string", description: "business street address" },
            hoods: { type: "string", description: "number of kitchen hoods (range or number)" },
            message: { type: "string", description: "any extra notes or details the caller mentioned" },
            intent: { type: "string", enum: ["quote", "inspection", "callback", "reschedule", "billing", "emergency", "opt_out", "other"], description: "primary reason for the call" },
            outcome: { type: "string", enum: ["booked", "callback_requested", "quote_captured", "not_interested", "dnc_request", "opt_out", "emergency_transfer"], description: "how the call ended" },
          },
        },
      },
    },
  };

  const res = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("PATCH failed", res.status, text.slice(0, 800));
    process.exit(1);
  }
  const a = JSON.parse(text);
  console.log("Assistant configured:");
  console.log("  id:", a.id);
  console.log("  name:", a.name);
  console.log("  model:", a.model?.provider + "/" + a.model?.model);
  console.log("  tools:", (a.model?.tools || []).map((t: { function?: { name?: string } }) => t.function?.name).join(", "));
  console.log("  server:", a.server?.url);
  console.log("  firstMessage:", (a.firstMessage || "").slice(0, 60) + "…");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
