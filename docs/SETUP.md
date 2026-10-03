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

| Integration | Variables                                    | Where to get them                                                               | Needed from |
| ----------- | -------------------------------------------- | ------------------------------------------------------------------------------- | ----------- |
| Anthropic   | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`       | <https://console.anthropic.com/settings/keys>                                   | Phase 5     |
| Stripe      | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | <https://dashboard.stripe.com/apikeys>; webhook endpoint `/api/webhooks/stripe` | Phase 6     |

All of these are server-only variables.

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
