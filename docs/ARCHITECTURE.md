# Architecture

CreativeFlow AI is a multi-tenant SaaS for agencies and video teams. It is a single Next.js 16 application backed by
Supabase (Postgres, Auth, Storage, Realtime), with Anthropic for AI generation and Stripe for payments.

```
 Browser ──HTTPS──▶ Next.js (Vercel / Node)
   │                 ├─ proxy.ts ............ refreshes the Supabase session cookie, coarse route guard
   │                 ├─ Server Components ... read data as the signed-in user (RLS applies)
   │                 ├─ Server Actions ...... validated mutations (zod) as the signed-in user
   │                 └─ Route Handlers ...... auth email callback, Stripe webhook (Phase 6)
   │                          │
   │      publishable key     │ user JWT (cookies)            secret key (server only, webhook only)
   ▼                          ▼                               ▼
 Supabase Realtime ◀──── Supabase Postgres + RLS ◀──────── Supabase Storage (private buckets)
                                 ▲
             Anthropic API ◀─────┤ (server only, Phase 5)
             Stripe API    ◀─────┘ (server only, Phase 6)
```

## Principles

1. **The database is the security boundary.** Every table has Row Level Security. The UI and server code check
   permissions too (for good error messages), but a bug there can never leak another agency's data because Postgres
   refuses the query.
2. **Act as the user.** All user-facing reads and writes use the user's own JWT (`src/lib/supabase/server.ts`). The
   secret-key client (`src/lib/supabase/admin.ts`) bypasses RLS and is reserved for trusted, already-authorised
   server tasks such as verified Stripe webhooks.
3. **Secrets never reach the browser.** Server-only modules import `server-only`, so importing them from a Client
   Component fails the build. Only `NEXT_PUBLIC_*` values (Supabase URL + publishable key, site URL) are public — and
   those are safe by design.
4. **No fake data.** Every number on screen is computed from database rows. Missing credentials produce honest setup
   states (`/setup`, disabled forms with explanations), not mock responses.
5. **Validate at every boundary.** zod schemas validate form input in Server Actions; Postgres `check` constraints and
   composite foreign keys validate again at the data layer.

## Multi-tenancy model

- A **workspace** is a tenant (one agency or team). Users can belong to several workspaces.
- `workspace_members` links a user to a workspace with a **role**:

  | Role      | Who                      | Can do                                                                              |
  | --------- | ------------------------ | ----------------------------------------------------------------------------------- |
  | `owner`   | Creator of the workspace | Everything, including deleting the workspace and granting `admin`                   |
  | `admin`   | Agency leadership        | Settings, members, invitations, finance                                             |
  | `manager` | Producers / PMs          | Clients, projects, invoices, approvals                                              |
  | `member`  | Creatives / editors      | Work on projects, tasks, assets, comments, AI Studio                                |
  | `client`  | External client contacts | Client portal only: shared projects and assets, comments, approvals, their invoices |

- Client users are bound to exactly one `clients` row (`workspace_members.client_id`). They only see projects with
  `client_visible = true` for that client, assets with `shared_with_client = true`, non-internal comments and
  non-draft invoices addressed to them.
- Every tenant-owned row has `workspace_id`. Children reference parents with **composite foreign keys**
  `(parent_id, workspace_id)`, so a row can never point at a parent in a different workspace, even via a crafted
  request.
- Access decisions live in `SECURITY DEFINER` helpers in the non-exposed `private` schema (`private.is_staff`,
  `private.can_manage`, `private.client_can_view_project`, …).
- The **active workspace** is a preference stored in an httpOnly cookie (`cf_workspace`). It is only a hint: every
  request re-resolves the user's memberships from the database (`src/lib/workspace.ts`).

## Authentication

- Supabase Auth with email + password. Sessions live in cookies managed by `@supabase/ssr`.
- `src/proxy.ts` (Next.js 16's replacement for `middleware.ts`) refreshes the session on every request and redirects
  signed-out users away from `/app` and `/onboarding`.
- Server code identifies the user with `supabase.auth.getClaims()`, which verifies the JWT signature — never with
  the unverified `getSession()`.
- Email links (sign-up confirmation, password recovery) land on `/auth/confirm`, which supports the token-hash
  template (recommended, works across browsers) and the PKCE `?code=` flow.
- Password reset does not reveal whether an account exists. `?next=` redirects are restricted to same-origin paths.

## Team invitations

1. An owner/admin submits the invite form. The Server Action checks the role and that the person isn't already a
   member. It generates 32 random bytes, stores only their SHA-256 hash in `workspace_invitations`, and returns the
   link `/invite/<token>` once.
2. The invitee opens the link. `/invite/[token]` calls `get_invitation(token)`, which works signed out because the
   token is the credential, and shows the workspace, role and expiry.
3. Signed out, the invitee chooses sign up or sign in, and `?next=/invite/<token>` is carried through. For a sign-up
   that needs email confirmation, a short-lived httpOnly cookie lets `/auth/confirm` return to the invite when the
   link is opened in the same browser.
4. Signed in with the invited email, the invitee clicks Join. `accept_invitation` re-validates the hash, expiry and
   email, adds the membership, and marks the invitation used. The app then switches to that workspace.

## Server-side authorization pattern

Every Phase 2 Server Action:

1. resolves the user and the active workspace from the database (`getWorkspaceContext`);
2. checks the role with `src/lib/permissions.ts`, which mirrors the RLS rules, to give clear errors;
3. validates input with zod;
4. filters every query by `workspace_id`;
5. treats "0 rows affected" as not found / not allowed.

RLS and triggers stay the final authority, and `src/lib/db-errors.ts` maps database errors to safe messages.

## Request lifecycle (example: dashboard)

1. `proxy.ts` refreshes the session cookie; signed-out → `/login?next=/app`.
2. `app/app/layout.tsx` calls `getWorkspaceContext()` → verified user, memberships, active workspace (or redirect to
   `/onboarding`).
3. `app/app/page.tsx` calls the `workspace_overview` RPC (security invoker, so RLS applies) and reads `activity_log`.
4. `loading.tsx` streams a skeleton meanwhile; `error.tsx` renders a recoverable error state on failure.

## Media pipeline (Phase 3)

- Files go to the private `project-assets` bucket under `{workspace_id}/{project_id}/{asset_id}/{file}`. Storage
  policies check workspace membership from the first path segment.
- Uploads: the browser requests a signed upload URL from a Server Action (which checks role + project), uploads
  directly to Storage (resumable/TUS for large video), then the server marks the `assets` row `ready`.
- Playback: short-lived signed URLs generated server-side per viewer.
- Review comments store `timestamp_seconds` (and an optional frame annotation) and stream live through Supabase
  Realtime (RLS applies to realtime subscriptions).

## AI generation (Phase 5)

- Server Action validates the brief, inserts an `ai_generations` row (`pending`), calls the Anthropic Messages API
  server-side with structured output (JSON schema for script scenes / storyboard frames), stores `output`, token
  usage and model, and marks it `completed` or `failed` with the error. Nothing is generated client-side.
- Per-workspace rate limits are enforced by counting recent `ai_generations` rows.

## Payments (Phase 6)

- Managers create invoices (draft → sent). Sending creates a Stripe Checkout Session server-side.
- `POST /api/webhooks/stripe` verifies the Stripe signature, then uses the secret-key client to insert into
  `payments`. A trigger recalculates `amount_paid_cents` and the invoice status. Users can never insert payments
  directly (enforced by RLS — tested in `scripts/test-db.mjs`).
- `payments.(provider, provider_payment_id)` is unique, which makes webhook processing idempotent.

## Technology choices

| Concern    | Choice                                        | Why                                                          |
| ---------- | --------------------------------------------- | ------------------------------------------------------------ |
| Framework  | Next.js 16 App Router, React 19, TypeScript   | Server Components + Server Actions keep secrets server-side  |
| Styling    | Tailwind CSS v4, shadcn/ui (Radix primitives) | Accessible primitives, owned component code                  |
| Data/Auth  | Supabase                                      | Postgres + RLS for tenant isolation, Auth, Storage, Realtime |
| Validation | zod                                           | Shared schemas for forms and server                          |
| AI         | Anthropic Messages API                        | Structured script/storyboard generation                      |
| Payments   | Stripe Checkout + webhooks                    | PCI scope stays with Stripe                                  |
| DB tests   | PGlite (Postgres in WASM) + Supabase stubs    | Runs RLS tests in CI without Docker                          |
