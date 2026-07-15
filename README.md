# VentWash

Marketing and lead-capture site for **VentWash** — commercial kitchen hood & exhaust cleaning to NFPA 96 standards.

The homepage is a scroll-driven **Three.js 3D experience** (a kitchen hood system that disassembles and gets cleaned as you scroll), backed by **PostHog analytics**, a password-protected **`/admin` dashboard** for funnel metrics and leads, and a **quote capture** flow that records submissions as PostHog events.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The admin dashboard lives at [http://localhost:3000/admin](http://localhost:3000/admin) — the password is whatever you set as `ADMIN_PASSWORD` in `.env.local`.

```bash
# first time only
cp .env.example .env.local   # then fill in the values (see below)
```

The site runs without any env vars configured — analytics calls become safe no-ops and the admin dashboard shows an unconfigured state — so you can develop the front end immediately.

## Environment setup

All variables live in `.env.local` (copy from `.env.example`).

| Variable | Required | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_POSTHOG_KEY` | For analytics | PostHog **Project API key** (`phc_...`). Public; shipped to the browser. |
| `NEXT_PUBLIC_POSTHOG_INGEST_HOST` | No | Override for non-US PostHog cloud ingestion (e.g. `https://eu.i.posthog.com`). Leave unset for US cloud. |
| `NEXT_PUBLIC_POSTHOG_ASSETS_HOST` | No | Override for non-US PostHog static assets (e.g. `https://eu-assets.i.posthog.com`). |
| `NEXT_PUBLIC_POSTHOG_UI_HOST` | No | Override for non-US PostHog app UI (e.g. `https://eu.posthog.com`). |
| `POSTHOG_PERSONAL_API_KEY` | For `/admin` | PostHog **Personal API key** (`phx_...`) with **Query Read** scope. Server-only; powers the admin dashboard queries. |
| `POSTHOG_PROJECT_ID` | For `/admin` | Numeric PostHog project id (from the PostHog URL). |
| `POSTHOG_API_HOST` | No | PostHog private-API host. Defaults to `https://us.posthog.com`; set `https://eu.posthog.com` for EU cloud. |
| `ADMIN_PASSWORD` | For `/admin` | Password for the admin dashboard login. **Change before deploying.** |
| `SESSION_SECRET` | For `/admin` | Random string used to sign the admin session cookie. Generate with `openssl rand -hex 32`. |

### Getting your PostHog keys

1. **Create a project** at [posthog.com](https://posthog.com) (free tier is fine). Pick US or EU cloud — remember which.
2. **Project API key** (`phc_...`): in PostHog go to **Settings → Project** and copy the *Project API Key*. Put it in `NEXT_PUBLIC_POSTHOG_KEY`.
3. **Personal API key** (`phx_...`): go to **Settings → Personal API Keys → Create personal API key**, give it the **Query Read** scope, and copy it into `POSTHOG_PERSONAL_API_KEY`. This one is secret — never expose it client-side.
4. **Project id**: it's the number in the PostHog URL, e.g. `app.posthog.com/project/12345` → `POSTHOG_PROJECT_ID=12345`.
5. **EU cloud only**: also set `NEXT_PUBLIC_POSTHOG_INGEST_HOST=https://eu.i.posthog.com`, `NEXT_PUBLIC_POSTHOG_ASSETS_HOST=https://eu-assets.i.posthog.com`, `NEXT_PUBLIC_POSTHOG_UI_HOST=https://eu.posthog.com`, and `POSTHOG_API_HOST=https://eu.posthog.com`. US cloud users can leave all four unset.

Browser events are proxied through the site's own `/ingest` path (a rewrite in `next.config.ts`) so ad blockers don't eat them.

## Analytics events

Everything the site captures, in one vocabulary:

| Event | Properties | Fired when |
| --- | --- | --- |
| `$pageview` | (PostHog defaults) | Any page loads (auto-captured by posthog-js). |
| `section_viewed` | `section_id`, `section_index` | A section of the scroll experience enters view (fired once per section per visit). |
| `experience_completed` | — | The visitor scrolls through the entire 3D experience to the end. |
| `quote_cta_clicked` | `location` | Any "Get a quote" button is clicked; `location` identifies which one (e.g. `nav`, `hero`, `final`). |
| `call_cta_clicked` | — | The phone-number / "call us" link is clicked. |
| `quote_submitted` | `name`, `business`, `phone`, `email`, `hoods`, `message` | The quote form is submitted. **Server-captured** (via `posthog-node` in the API route) so leads are recorded even if the client is blocked. |

The `/admin` dashboard reads these events back through PostHog's Query API to build the funnel and the leads table.

## Project structure

```
src/
  app/                    # Next.js App Router pages & API routes
    page.tsx              #   homepage (3D scroll experience)
    admin/                #   password-protected analytics dashboard
    api/                  #   quote submission, admin auth/queries, voice stub
  components/
    experience/           # Three.js scene, scroll controller, overlay sections
    quote/                # quote form + CTA components
    admin/                # dashboard charts (recharts), leads table, login
  lib/                    # analytics helper, PostHog query client, session utils
design-src/               # original static design prototype, kept for reference
```

Notes for contributors:

- **three.js is pinned to `0.128.0`.** It uses the old r128 API (`renderer.outputEncoding`, `sRGBEncoding`, etc.). Do not upgrade or "modernize" the renderer setup.
- Fonts (Archivo, IBM Plex Mono, Instrument Serif) are loaded via `<link>` tags in `src/app/layout.tsx`.
- `src/lib/analytics.ts` exports a `track(event, properties?)` helper that no-ops safely when PostHog isn't configured — always use it instead of calling `posthog` directly.

## Deploying

**Vercel (recommended):**

1. Push the repo to GitHub and import it at [vercel.com/new](https://vercel.com/new).
2. Add the environment variables from the table above in the Vercel project settings.
3. Deploy. That's it — no extra config needed.

**Other hosts:** anything that runs Next.js on Node works (`npm run build && npm start`). The `/ingest` analytics proxy is a standard Next.js rewrite, so it works on any Node host — no Vercel-specific features are used.

## Roadmap

- **AI voice answering** — a phone agent that answers calls 24/7, captures quote requests into the same PostHog pipeline as the web form, and routes emergencies to a human. Full implementation plan: [docs/voice-automation-plan.md](docs/voice-automation-plan.md). A stub webhook already exists at `src/app/api/voice/route.ts`.
