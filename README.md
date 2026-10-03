# CreativeFlow AI

The operating system for advertising agencies, video creators and creative teams. It brings projects, client reviews
with timestamped comments, approvals and revisions, AI scripts and storyboards, invoicing and payments, analytics and
team collaboration into one secure, multi-tenant workspace.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · Supabase (Postgres + RLS,
Auth, Storage, Realtime) · Google Gemini (or Anthropic) · Stripe

> **Status: Phase 1 (foundation).** Auth, workspaces, the app shell, the dashboard and the full database schema are
> live. See [docs/ROADMAP.md](docs/ROADMAP.md) for what ships next.

## Quick start

```bash
npm install
cp .env.example .env.local    # then fill in your Supabase URL + publishable key
npx supabase link --project-ref <ref> && npx supabase db push
npm run dev
```

Full instructions are in [docs/SETUP.md](docs/SETUP.md). Without credentials the app still runs and tells you what is
missing at `/setup`. It never falls back to mock data.

## Documentation

| Doc                                          | Contents                                                     |
| -------------------------------------------- | ------------------------------------------------------------ |
| [docs/SETUP.md](docs/SETUP.md)               | Supabase, auth emails, env vars, deployment, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, tenancy & security model, request lifecycle   |
| [docs/DATABASE.md](docs/DATABASE.md)         | Tables, RPCs, RLS access matrix, storage, migration workflow |
| [docs/ROADMAP.md](docs/ROADMAP.md)           | Phased implementation plan                                   |

## Scripts

| Command             | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `npm run dev`       | Start the dev server                                      |
| `npm run build`     | Production build                                          |
| `npm run lint`      | ESLint                                                    |
| `npm run typecheck` | Generate route types and run TypeScript                   |
| `npm run test:db`   | Apply migrations to in-process Postgres and run RLS tests |
| `npm run check`     | lint + typecheck + test:db                                |
| `npm run format`    | Prettier                                                  |
| `npm run db:types`  | Generate DB types from the linked Supabase project        |

## Folder structure

```
├── docs/                       Architecture, database, roadmap, setup
├── scripts/test-db.mjs         Migration + Row Level Security test suite (PGlite)
├── supabase/
│   ├── config.toml             Supabase CLI config
│   ├── migrations/             SQL migrations (schema, RLS, storage, RPCs)
│   └── templates/              Auth email templates (token-hash flow)
└── src/
    ├── proxy.ts                Session refresh + route protection (Next 16 "proxy", formerly middleware)
    ├── app/
    │   ├── (marketing)/        Landing page + public header/footer
    │   ├── (auth)/             login, signup, forgot-password, reset-password
    │   ├── auth/confirm/       Email link handler (verifyOtp / code exchange)
    │   ├── onboarding/         Create workspace
    │   ├── setup/              Integration status + configuration guide
    │   └── app/                Authenticated app: layout (sidebar), dashboard, settings, loading/error
    ├── components/
    │   ├── ui/                 shadcn/ui components
    │   ├── app/                App shell: sidebar, switcher, notifications, user menu, forms
    │   ├── auth/               Auth forms
    │   ├── forms/              Field, submit button, form message
    │   ├── marketing/          Landing page pieces
    │   └── brand/              Logo
    ├── lib/
    │   ├── actions/            Server Actions (auth, workspace, notifications)
    │   ├── auth/session.ts     Verified current user (getClaims)
    │   ├── env/                public.ts (browser-safe) / server.ts (server-only secrets)
    │   ├── supabase/           client, server, proxy, admin (secret key) clients
    │   ├── validation/         zod schemas
    │   ├── navigation.ts       Sidebar definition (with roadmap phases)
    │   ├── routes.ts           Protected routes + safe redirects
    │   └── workspace.ts        Memberships, active workspace, roles
    └── types/database.ts       Typed schema for supabase-js
```

## Security model (summary)

- Every table has Row Level Security. Tenant isolation is enforced by Postgres and covered by `npm run test:db`.
- Users act with their own JWT. The secret key is used only by trusted server code such as verified webhooks.
- Server-only modules import `server-only`, so secrets can't be bundled into client code.
- Invitation tokens are stored as SHA-256 hashes. Payments can only be written by the server. Notifications are
  read-only to users except for `read_at`.
