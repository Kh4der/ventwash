# Hosting & Setup Runbook — VentWash automations

Plain-English answer to: **what are these agents made of, where do they run, what do I plug in, and can I use Claude or a free model?**

---

## 1. What "the agents" actually are

There is no separate "agent server." The automations are **code inside this one Next.js app** plus a few **rented services** the code calls over HTTPS. Three moving parts:

1. **This app (the brain + system of record).** Route handlers, a SQLite/libSQL database, and a **job queue** (`jobs` table) drained by one cron endpoint. This owns every lead, appointment, consent record, and compliance gate. It runs wherever Next.js runs.
2. **A voice platform (the ears + mouth of the phone agent).** It answers/places calls, turns speech→text and text→speech, and runs the LLM conversation. We use **Vapi**. It calls *back into* this app via the `POST /api/voice` webhook. This is the only piece that is "an agent" in the chatbot sense.
3. **Provider APIs (the hands).** Twilio (the phone number + SMS + line-type lookup), Resend (email), OpenStreetMap Overpass (lead discovery). The app talks to these with plain `fetch()`.

So: **the "AI agent" is a Vapi assistant** (a prompt + voice + tools you configure in Vapi's dashboard). Everything else — booking, reminders, onboarding, lead-gen — is deterministic code in this repo, not an LLM.

```
Caller's phone
      │  (dials your Twilio number)
      ▼
   Twilio ──────────────► Vapi assistant ──────────► LLM (Claude / free model)
   (number)              (STT + TTS + turn-taking)   (decides what to say)
                              │  webhook: POST /api/voice
                              │  tool calls: POST /api/vapi/tools
                              ▼
                    ┌───────────────────────┐
                    │   THIS NEXT.JS APP     │   ◄── you host this
                    │  • leads / appts DB    │
                    │  • job queue + cron    │
                    │  • compliance gates    │
                    │  • /admin dashboard    │
                    └───────┬───────┬────────┘
                            │       │  fetch()
                 Resend ◄───┘       └───► Twilio SMS / OSM Overpass
                 (email)
```

---

## 2. Inbound vs outbound — you already have both

- **Inbound** (someone calls *you*): the humorous answering agent. This is **Phase 2**, the lowest-risk and first voice piece to ship. Persona lives in `src/lib/voice/scripts.ts` (`INBOUND_SYSTEM_PROMPT`, `INBOUND_FIRST_MESSAGE`) — dry, self-aware bot humor, but it always discloses it's automated and goes dead serious on emergencies.
- **Outbound** (the app calls *leads*): quote-callbacks and appointment reminders, gated hard by TCPA rules. **Phase 5**, and cold leads are never AI-dialed — only a human "bridge" call.

Both use the **same Vapi account and the same `POST /api/voice` webhook**; they're just two assistants (inbound / outbound IDs).

---

## 3. Where to host — pick one

| Option | The app | The database | Cron (reminders) | Good for |
|---|---|---|---|---|
| **A. Vercel + Turso** (recommended) | Vercel (free Hobby, or $20/mo Pro) | Turso free tier | Vercel Cron (Pro = every 5 min) **or** a free external pinger on Hobby | Least ops; matches the code's design |
| **B. One small VPS** (Railway / Render / Fly / a $5 droplet) | `npm run build && npm start` | libSQL `file:` on a persistent disk, or Turso | a system cron hitting `/api/cron/tick` | You want one box you control |
| **C. Local / self-host** | `npm run dev` | `file:./data/ventwash.db` (automatic) | `npm run tick` in a second terminal | Development and testing only |

**Why Turso on Vercel specifically:** Vercel's filesystem is wiped between requests, so a local `.db` file would silently lose rows (including consent records). The code detects this and **disables the database entirely on Vercel unless Turso is configured** — a deliberate fail-safe. On a VPS with a real disk, the `file:` database is fine.

**The reminder-timing catch:** reminders/confirmations depend on the cron endpoint firing every few minutes. Vercel **Hobby** only allows *daily* cron — too slow. Fix it one of two ways: upgrade to Vercel **Pro** ($20/mo), or keep Hobby and point a free scheduler (cron-job.org, GitHub Actions, or your VPS's crontab) at `https://yoursite.com/api/cron/tick` every 5 minutes with the `Authorization: Bearer <CRON_SECRET>` header. The endpoint is host-agnostic on purpose.

---

## 4. The LLM — Claude, or a free model?

Vapi lets you **bring your own model**. Three realistic choices for the answering agent's brain:

1. **Claude (recommended for quality + humor).** In the Vapi assistant, set the model provider to **Anthropic** and the model to `claude-sonnet-5` (fast, cheap, great at tone) or `claude-fable-5` (smartest). You supply an **Anthropic API key** (from console.anthropic.com); Vapi passes each turn to Claude. Paste `INBOUND_SYSTEM_PROMPT` from `scripts.ts` as the system prompt. This is "using Claude natively."
2. **A free / near-free model.** Point Vapi at an **OpenAI-compatible endpoint** with a free tier — e.g. **Groq** (Llama 3.x, very fast, generous free tier) or **OpenRouter** (has free model slots). Vapi's "custom LLM" / OpenAI-compatible option takes a base URL + key. Good enough for simple quote intake; humor and edge-case handling are noticeably weaker than Claude.
3. **Fully self-hosted model (Ollama, etc.).** Only works if you expose an OpenAI-compatible URL Vapi can reach over the internet. Cheapest per-token, most ops. Not worth it at your call volume.

**Important honesty about "free":** the **LLM** can be free/cheap, but a **phone agent is never fully free** — Twilio charges for the number (~$1–2/mo) and per-minute calls, and Vapi/STT/TTS bill per minute (~$0.05–0.15/min all-in). Budget roughly **$0.10–0.20 per call minute** regardless of which LLM you pick. The model is the *small* part of that bill; picking a free LLM saves maybe a cent a minute. **Use Claude — the quality difference matters more than the cost difference.**

### The "no Vapi at all, pure Claude" path (advanced, later)
The spec's Phase 3 v2 is a DIY stack: Twilio Media Streams → a speech-to-text service → **Claude via the Anthropic API** (driven by *this app's* code) → a text-to-speech service. That's "Claude natively" with no voice-platform middleman, but it's weeks of WebSocket/latency engineering. The webhook contract is identical, so **start with Vapi + Claude and only go DIY if call volume ever justifies it** (>~2,000 min/month).

---

## 5. Step-by-step: get the inbound humor agent live

Do these in order. Steps 1–3 make the whole app run; 4–6 turn on the phone agent.

### Step 1 — Database (Turso, ~5 min)
1. Install the CLI and sign up: `turso auth signup`.
2. `turso db create ventwash` → then `turso db show ventwash --url` (that's `TURSO_DATABASE_URL`).
3. `turso db tokens create ventwash` (that's `TURSO_AUTH_TOKEN`).
4. Put both in `.env.local` (and later in Vercel's env vars). *(Skip this entirely for local dev — a file database is created automatically.)*

### Step 2 — Email (Resend, ~10 min)
1. Sign up at resend.com, verify a **sending domain** (add the SPF/DKIM DNS records they give you — this is what keeps you out of spam).
2. Create an API key → `RESEND_API_KEY`.
3. Set `EMAIL_FROM="VentWash <hello@yourdomain.com>"`, `EMAIL_REPLY_TO`, and your real `BUSINESS_POSTAL_ADDRESS` (legally required in emails).
4. Add the webhook `https://yoursite.com/api/webhooks/resend` in Resend → `RESEND_WEBHOOK_SECRET`.

### Step 3 — Deploy the app + cron
1. Push to GitHub, import at vercel.com/new, paste all `.env` values into Vercel project settings.
2. Set `ADMIN_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`), `CRON_SECRET`, `SITE_BASE_URL=https://yoursite.com`.
3. Add a cron (Vercel Pro `vercel.json`, or an external pinger) hitting `GET /api/cron/tick` every 5 min with the Bearer header.
4. Open `/admin` → log in → you'll see the pipeline, jobs, and compliance tabs.

### Step 4 — Phone number (Twilio, ~15 min)
1. Sign up at twilio.com, buy a local number (~$1.15/mo).
2. Get `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`; set `OUTBOUND_CALLER_ID` to your new number.
3. *(For SMS reminders only — later:)* register **A2P 10DLC** (brand + campaign) before setting `SMS_ENABLED=1`. Skip for inbound-voice-only launch.

### Step 5 — The voice agent (Vapi, ~30 min) ← the fun part
1. Sign up at vapi.ai.
2. **Model:** provider **Anthropic**, model `claude-sonnet-5`, and your **`ANTHROPIC_API_KEY`** (get it at console.anthropic.com). *(Or pick Groq/OpenAI-compatible for the free route.)*
3. **System prompt:** paste `INBOUND_SYSTEM_PROMPT` from `src/lib/voice/scripts.ts` (the humorous-but-compliant persona).
4. **First message:** paste `INBOUND_FIRST_MESSAGE`.
5. **Voice:** pick a natural TTS voice (ElevenLabs/PlayHT/Deepgram — all selectable in Vapi). Test a few; a warm, slightly upbeat voice sells the humor.
6. **Tools:** add four custom tools pointing at `https://yoursite.com/api/vapi/tools` — `check_availability`, `book_appointment`, `mark_dnc`, `request_callback` (the app implements all four).
7. **Server webhook:** set the assistant's server URL to `https://yoursite.com/api/voice` and a secret → `VAPI_WEBHOOK_SECRET`.
8. **Import your Twilio number** into Vapi and attach this assistant to it. Copy the Vapi phone-number id → `VAPI_PHONE_NUMBER_ID`, the assistant id → `VAPI_ASSISTANT_INBOUND_ID`, and your Vapi API key → `VAPI_API_KEY`.
9. **Recording stays off** unless you set `RECORDING_ENABLED=1` (and only after adding the recording-consent line to the greeting — two-party-consent states require it).

### Step 6 — Test it
1. Call your number. You should hear the humorous greeting, be able to ask for a quote or book a slot, and say "stop calling" to opt out.
2. Watch `/admin` → **Pipeline** (a lead appears) and **Compliance → Call log** (disclosure verified ✓, consent snapshot).
3. Run `npm run verify:voice-config` — it fails CI if the live Vapi greeting ever drifts from the compliant script in the repo.

That's the inbound agent live. Outbound (quote-callbacks, reminders) reuses the same setup with the outbound assistant id and the channel kill-switches in `/admin` — turn those on only after counsel signs off on the scripts (Phase 5).

---

## 6. Monthly cost, realistically

| Service | Free tier covers you? | Paid |
|---|---|---|
| Vercel | Yes for the app; Hobby cron is daily-only | Pro $20/mo for 5-min cron (or use a free pinger) |
| Turso | Yes at this volume | $0 |
| Resend | 3,000 emails/mo free | $0 |
| Twilio number | No | ~$1.15/mo + ~$0.014/min calls + SMS per-segment |
| Vapi + STT/TTS | Small trial credit | ~$0.05–0.15/min |
| Anthropic (Claude) | Pay-as-you-go | pennies/call; the smallest line item |

**Realistic starting point: ~$25–50/month** for a low call volume with a 5-minute cron, Claude as the brain, and inbound answering only.
