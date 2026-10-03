# Setup guide

You need **Node.js 20.11+** (22 LTS recommended) and a **Supabase** project. Anthropic and Stripe are optional until phases 5 and 6. The
app shows what is configured at `/setup`. It shows true/false only and never displays secret values.

## 1. Install

```bash
git clone https://github.com/tariqkhan197/creativeflow-ai.git
cd creativeflow-ai
npm install
cp .env.example .env.local
```

## 2. Create the Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**. Pick a region close to your users and save the database
   password.
2. Open **Project Settings → API Keys** (and **Data API** for the URL) and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Publishable key (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
     (the legacy `anon` key also works)
   - Secret key (`sb_secret_…`) → `SUPABASE_SECRET_KEY`. **Server only. Never prefix it with `NEXT_PUBLIC_`.**
3. Set `NEXT_PUBLIC_SITE_URL` to the URL the app runs on (`http://localhost:3000` locally). Production builds stop
   with a clear "Configuration error" if it is missing. On Vercel (production and preview), or on other hosts with
   `REQUIRE_PUBLIC_SITE_URL=true`, it must also be a public `https://` origin, never localhost.

> `NEXT_PUBLIC_*` values are inlined at build time. After changing them, restart `npm run dev` or rebuild.

## 3. Apply the database schema

**Option A: Supabase CLI (recommended)**

```bash
npx supabase login                                     # opens the browser; no token is pasted anywhere
npx supabase link --project-ref <your-project-ref>     # prompts for the database password (input is hidden)
npx supabase migration list                            # Local vs Remote: every migration should show as local-only
npx supabase db push --dry-run                         # shows what would be applied, changes nothing
npx supabase db push                                   # applies supabase/migrations/* in order
npx supabase migration list                            # every migration now shows in the Remote column too
npm run db:types                                       # optional: generate exact TS types
```

The project ref is the `<ref>` in `https://<ref>.supabase.co`. `db push` only applies migrations that the remote
database hasn't recorded yet. Running it again is safe. Only run it against a fresh project, or one that has only
ever been migrated from this repository.

**Option B: SQL editor.** Open **SQL Editor** in the dashboard and run each file in `supabase/migrations/` once, in
filename order. (The CLI won't know about migrations applied this way, so pick one option and stick with it.)

This creates all tables, RLS policies, RPC functions, the `project-assets` and `avatars` storage buckets, and enables
Realtime on notifications and review comments.

## 4. Configure authentication

In **Authentication → URL Configuration**:

- **Site URL**: your app URL, for example `http://localhost:3000` or `https://app.yourdomain.com`
- **Redirect URLs**: add `http://localhost:3000/auth/confirm` and `https://app.yourdomain.com/auth/confirm`

In **Authentication → Providers → Email**, keep **Confirm email** on (recommended).

In **Authentication → Email Templates**, replace the bodies of these templates with the files in `supabase/templates/`.
They use the token-hash flow, so links work even when opened in a different browser:

| Template       | File                                   |
| -------------- | -------------------------------------- |
| Confirm signup | `supabase/templates/confirmation.html` |
| Reset password | `supabase/templates/recovery.html`     |

The default templates also work, but only when the link is opened in the same browser that requested it.

For production, configure **custom SMTP** (Authentication → SMTP Settings). Supabase's built-in email sender is
heavily rate-limited and is meant for testing only.

### Applying later migrations

When you pull new code that adds files to `supabase/migrations/`, run `npx supabase migration list`,
`npx supabase db push --dry-run` and then `npx supabase db push`. Only the new files are applied.

> **Phase 4 (`20261004000000_phase4_client_portal.sql`)** makes client access stricter: client users can no longer
> read `projects` or `clients` directly, and the portal reads them through `portal_projects()`. Deploy the Phase 4
> app code together with this migration. An older app version would show existing client users an empty project
> list.

### Upload size limit

The Storage upload limit is set per project (Dashboard → Storage → Settings → "Upload file size limit") and depends
on your plan. On the Free plan it is 50 MB. The bucket limit is read automatically, but the project-wide limit
cannot be read through the API. To reject oversize files before an upload starts, set it in `.env.local`:

```bash
STORAGE_MAX_UPLOAD_BYTES=52428800   # 50 MB, use your project's value
```

Without it, Supabase still enforces the limit during the upload, and the app shows a clear "larger than your Supabase
project allows" error.

### Realtime

The migrations add `review_comments` (and `notifications`) to the `supabase_realtime` publication. To check it on
your project, open Dashboard → SQL Editor and run (read-only):

```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
```

`review_comments` should be listed. `npm run verify:supabase` also checks it: the Realtime server either confirms
a subscription on the table or rejects it with `RealtimeDisabledForConfiguration`.

If it is missing, enable it under Database → Publications → `supabase_realtime`. Live updates still respect RLS for
each subscriber.

## 5. Verify the project

```bash
npm run verify:supabase            # env, auth settings, tables, RPCs, storage buckets (read-only)
npm run verify:supabase -- --e2e   # + creates two throwaway users, signs in, creates a workspace,
                                   #   checks tenant isolation, then deletes everything it created
```

The script reads `.env.local` and never prints key values. Fix anything marked ✗ before continuing.

## 6. Run

```bash
npm run dev
```

Open <http://localhost:3000>, create an account, confirm your email and create your workspace.

## 7. Optional integrations

| Integration | Variables                                                                                              | Where to get them                                                               | Needed from                               |
| ----------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------- |
| Gemini      | `GEMINI_API_KEY`, `GEMINI_MODEL`, plus `SUPABASE_SECRET_KEY` (`AI_PROVIDER=gemini`, the default)       | <https://aistudio.google.com/app/apikey>                                        | Phase 5 (AI Studio)                       |
| Anthropic   | `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (optional), plus `SUPABASE_SECRET_KEY` | <https://console.anthropic.com/settings/keys>                                   | Phase 5 (AI Studio), optional alternative |
| Stripe      | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                                           | <https://dashboard.stripe.com/apikeys>; webhook endpoint `/api/webhooks/stripe` | Phase 6                                   |

All of these are server-only variables.

### AI Studio (Phase 5)

AI Studio calls one provider, chosen with `AI_PROVIDER`: `gemini` (the default, free tier) or `anthropic` (paid).
Only the selected provider is called. If it isn't fully configured, AI Studio shows "isn't set up" and nothing is
sent anywhere; the app never falls back to another provider or model.

#### Google Gemini (free tier, default)

1. In [Google AI Studio](https://aistudio.google.com/app/apikey), create an API key in a Google Cloud project that
   has **no billing account linked**. Without billing, the project can only use free-tier quota: requests beyond it
   (or to models without a free tier) fail with a clear message and are never charged. Linking billing moves the
   project to a paid tier.
2. Choose the model. Open the [Gemini API pricing page](https://ai.google.dev/gemini-api/docs/pricing) and pick a
   text model whose **Free Tier** column says "Free of charge" for input and output, then check its free limits on
   the [rate limits page](https://ai.google.dev/gemini-api/docs/rate-limits) (also shown per project in AI Studio).
   Prefer a stable model code over a `-preview` one; previews change and are retired at short notice. There is
   deliberately no default model, so nothing is picked implicitly.
3. Set `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL` and `SUPABASE_SECRET_KEY` (the server records AI
   results with it) in `.env.local`, and in Vercel under Production (server-only; never prefix them with
   `NEXT_PUBLIC_`). The app treats an unset `AI_PROVIDER` as `gemini`, but the live test below needs it set
   explicitly.
4. Check the key and model with the live test (see [Live AI test](#live-ai-test)): one real request (a 10-second
   script) that uses one request of the free daily quota and writes nothing to the database.

Free-tier limitations to know about:

- **Daily and per-minute limits are Google's, per Google Cloud project** (not per key or per workspace) and depend
  on the model. They can be lower than the app's own limits below. When the daily quota is used up, AI Studio says
  so and when it resets (midnight Pacific time); when the per-minute limit is hit, it asks people to wait a minute.
  A model without free quota is reported as such. None of these are retried automatically, so they don't burn
  more quota. Failed calls still count toward the app's limits.
- **Data use:** on the free (unpaid) tier, Google may use prompts and responses to improve its products, and human
  reviewers may read them ([Gemini API terms](https://ai.google.dev/gemini-api/terms)). The brief form tells people
  this; don't put confidential client material in briefs while on the free tier.
- **Availability:** the free tier isn't offered in every country; from an unsupported region the API refuses
  requests and AI Studio reports that the Gemini API can't be used from this project or region.
- Gemini doesn't have Claude's "effort" setting; the model's default thinking is used. Token counts stored with each
  run include thinking tokens.

#### Anthropic (paid, optional)

1. Set `AI_PROVIDER=anthropic`.
2. Create an API key at <https://console.anthropic.com/settings/keys> and add credits or billing. Set a monthly
   spend limit there (Settings → Limits) as a hard cap.
3. Set `ANTHROPIC_API_KEY` and `SUPABASE_SECRET_KEY` as above.
4. Optional: `ANTHROPIC_MODEL`. The default is `claude-sonnet-5-5` (Claude Sonnet 5.5, $2 / $10 per million input /
   output tokens). A value that isn't a valid Anthropic model ID disables AI Studio with a clear message.
5. The live test with `AI_PROVIDER=anthropic` makes one small real request (a few cents) and writes nothing to the
   database.

The app also limits usage with either provider: 50 AI calls per workspace per 24 hours and 20 per user per hour
(failed calls count). `/setup` shows AI Studio as configured only when the selected provider's settings and the
Supabase secret key are set.

#### Live AI test

`npm run test:ai-live` sends one real request to the provider named by `AI_PROVIDER`, and only to that provider:
with `gemini` it uses `GEMINI_API_KEY` and `GEMINI_MODEL` and never contacts Anthropic; with `anthropic` it uses
`ANTHROPIC_API_KEY` (and `ANTHROPIC_MODEL`, optional). It reads `.env.local`; variables set in the shell take
precedence. If `AI_PROVIDER` or a required setting is missing it stops with a message naming the setting (values
are never printed), and API errors show the same safe message as the app (for example the daily free quota).

In PowerShell, from the project folder. Keep the key in `.env.local` rather than typing it into the shell, so it
doesn't end up in the PowerShell history:

```powershell
# .env.local should contain (with your own values):
#   AI_PROVIDER=gemini
#   GEMINI_API_KEY=<your Gemini API key>
#   GEMINI_MODEL=<a free-tier Gemini model code>
npm run test:ai-live
```

To try a different provider or model for one run without editing `.env.local`, set it for the current PowerShell
session and remove it afterwards:

```powershell
$env:AI_PROVIDER = "gemini"
$env:GEMINI_MODEL = "<a free-tier Gemini model code>"
npm run test:ai-live
Remove-Item Env:\AI_PROVIDER, Env:\GEMINI_MODEL
```

If the test calls the wrong provider, check for leftover session variables (this prints the provider and True/False for
each key, never key values) and make sure you have the latest code (`src\lib\ai\ai.live.test.ts` must exist; older checkouts had a
live test that always called Anthropic):

```powershell
$env:AI_PROVIDER
Test-Path Env:\GEMINI_API_KEY, Env:\GEMINI_MODEL, Env:\ANTHROPIC_API_KEY
git pull
Test-Path src\lib\ai\ai.live.test.ts
```

Generating a script usually takes under a minute but can take up to about two and a half minutes. The AI Studio pages
set `maxDuration = 300` (seconds) for their Server Actions. Check that your Vercel plan allows this function duration
(Project → Settings → Functions); on a plan with a lower maximum, long generations stop early and are shown as
failed after 15 minutes.

## 8. Checks

```bash
npm run lint         # ESLint
npm run typecheck    # Next route types + TypeScript
npm run test:unit    # Vitest unit + integration tests (includes a real TUS server)
npm run test:db      # migration + RLS tests in in-process Postgres (no Docker needed)
npm run build        # production build
npm run check        # lint + typecheck + test:unit + test:db
npm run test:browser # review UI in Chromium (after `npm run build`; run `npx playwright install chromium` once)
```

The manual browser checklist for each phase is in [docs/TESTING.md](TESTING.md).

## 9. Deploy (Vercel)

1. Apply any new migrations to the Supabase project first (section 3, "Applying later migrations").
2. Import the GitHub repository in Vercel (framework preset: Next.js; Node 20.11+).
3. Under **Settings → Environment Variables → Production**, set:
   - `NEXT_PUBLIC_SITE_URL`: the public `https://` URL (origin only). The build stops with a "Configuration
     error" if it is missing or points to localhost.
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   - Optional: `STORAGE_MAX_UPLOAD_BYTES`.
   - Not needed yet: `SUPABASE_SECRET_KEY` (only `verify:supabase` uses it, on your machine), Stripe and Anthropic
     keys. Leave them out of Vercel until a feature needs them.
4. In Supabase → **Authentication → URL Configuration**, set the Site URL to the same production URL and add
   `https://<your domain>/auth/confirm` to Redirect URLs. Set up custom SMTP and the email templates (section 4).
5. Deploy. After adding a custom domain, update `NEXT_PUBLIC_SITE_URL` and the Supabase Site URL to it and redeploy
   (`NEXT_PUBLIC_*` values are fixed at build time).
6. Smoke test on the production URL: sign up (confirmation email link), sign in, reset a password, create a
   workspace, invite a teammate and a client, upload a file, comment, request approval, and as the client request
   changes and approve. Check the response headers include `X-Frame-Options: DENY`.

Every response carries security headers (frame protection, `nosniff`, referrer and permissions policies, HSTS);
see `src/lib/security-headers.ts`. `/setup` is public only until Supabase is configured, then owners and admins
only.

## Troubleshooting

| Symptom                               | Fix                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Redirected to `/setup`                | `NEXT_PUBLIC_SUPABASE_URL` / `…_PUBLISHABLE_KEY` missing; restart the dev server after setting them                   |
| "Could not sign you in"               | Supabase unreachable or wrong key; check the URL and key and the server logs                                          |
| Confirmation link → "link is invalid" | Link already used or expired, `/auth/confirm` not in Redirect URLs, or default template opened in a different browser |
| "Could not create the workspace"      | Migration not applied; run step 3                                                                                     |
| No confirmation email                 | Built-in mailer rate limit; configure custom SMTP                                                                     |
