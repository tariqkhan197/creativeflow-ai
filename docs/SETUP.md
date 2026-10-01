# Setup guide

You need **Node.js 20.9+** and a **Supabase** project. Anthropic and Stripe are optional until phases 5 and 6. The
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
3. Set `NEXT_PUBLIC_SITE_URL` to the URL the app runs on (`http://localhost:3000` locally).

> `NEXT_PUBLIC_*` values are inlined at build time. After changing them, restart `npm run dev` or rebuild.

## 3. Apply the database schema

**Option A: Supabase CLI (recommended)**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>   # the ref is in your project URL
npx supabase db push                                   # applies supabase/migrations/*
npm run db:types                                       # optional: generate exact TS types
```

**Option B: SQL editor.** Open **SQL Editor** in the dashboard, paste the contents of
`supabase/migrations/20261001000000_initial_schema.sql` and run it once.

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

## 5. Run

```bash
npm run dev
```

Open <http://localhost:3000>, create an account, confirm your email and create your workspace.

## 6. Optional integrations

| Integration | Variables                                    | Where to get them                                                               | Needed from |
| ----------- | -------------------------------------------- | ------------------------------------------------------------------------------- | ----------- |
| Anthropic   | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`       | <https://console.anthropic.com/settings/keys>                                   | Phase 5     |
| Stripe      | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | <https://dashboard.stripe.com/apikeys>; webhook endpoint `/api/webhooks/stripe` | Phase 6     |

All of these are server-only variables.

## 7. Checks

```bash
npm run lint         # ESLint
npm run typecheck    # Next route types + TypeScript
npm run test:db      # migration + RLS tests in in-process Postgres (no Docker needed)
npm run build        # production build
npm run check        # lint + typecheck + test:db
```

## 8. Deploy (Vercel)

1. Import the GitHub repository in Vercel.
2. Add every variable from `.env.example` under **Settings → Environment Variables**. Set `NEXT_PUBLIC_SITE_URL` to
   the production URL.
3. Add the production `/auth/confirm` URL to Supabase's redirect allow-list and update the Site URL.
4. Deploy.

## Troubleshooting

| Symptom                               | Fix                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Redirected to `/setup`                | `NEXT_PUBLIC_SUPABASE_URL` / `…_PUBLISHABLE_KEY` missing; restart the dev server after setting them                   |
| "Could not sign you in"               | Supabase unreachable or wrong key; check the URL and key and the server logs                                          |
| Confirmation link → "link is invalid" | Link already used or expired, `/auth/confirm` not in Redirect URLs, or default template opened in a different browser |
| "Could not create the workspace"      | Migration not applied; run step 3                                                                                     |
| No confirmation email                 | Built-in mailer rate limit; configure custom SMTP                                                                     |
