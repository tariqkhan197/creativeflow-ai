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

```
Browser                      Next.js (Server Actions)                Supabase
───────                      ────────────────────────                ────────
pick file ─▶ createAssetUpload ─ validate type/size, derive ─▶ INSERT assets (status uploading,
             (zod, role)         workspace + project + path         path {ws}/{project}/{asset}/{file})
probe file (duration, size,
fps, JPEG thumbnail)
TUS upload, 6 MB chunks ───────────────────────────────────────▶ Storage (RLS: only the uploader's
   user JWT + publishable key                                      in-progress asset path)
thumbnail upload ──────────────────────────────────────────────▶ Storage ({…}/thumbnail.jpg)
             finalizeAssetUpload ──────────────────────────────▶ finalize_asset_upload(): checks the
                                                                    stored object's real size/type,
                                                                    sets ready + metadata + thumbnail
review page ◀─ signed URLs (1 h, renewed) ◀─ getAssetMediaUrls ◀─ RLS on assets + storage.objects
comments ◀──── Realtime postgres_changes (RLS per subscriber) ◀── review_comments
```

- Workspace and project are always derived on the server. The database also rejects any path that isn't exactly
  `{workspace}/{project}/{asset id}/{safe name}`.
- A failed upload keeps its record (status `failed`) and is retried on the same record and path, so there are no
  duplicates. Cancelling removes whatever reached Storage before removing the record.
- Deleting an asset or project removes Storage objects first and checks the folders are empty. Only then are the
  rows deleted. A partial failure keeps the records so the action can be retried, and nothing is orphaned silently.
- Signed URLs are created after an access check. The player renews them before expiry, and once more after a load
  error. A repeat failure shows an honest "can't be previewed / couldn't be loaded" state with a download option.
- Realtime: the browser authenticates its socket with the user's own token. Supabase evaluates the
  `review_comments` RLS policy for every subscriber, so clients never receive internal notes and other workspaces
  receive nothing. After a reconnect the panel re-fetches the thread. Updates are merged "newer wins" by parsed
  `updated_at`.

## Client portal & approvals (Phase 4)

- **Routing.** Client users work in `/portal`, staff in `/app`; each layout redirects the other role. This is for
  navigation only: every page and Server Action re-checks the role, and the database decides what is visible.
- **What clients can read.** They can't select from `projects` or `clients`, which hold the budget, internal brief
  and the agency's notes. The portal uses `portal_projects()` / `portal_project()`, which return safe columns for the
  client's own portal-visible projects only. Assets, comments and approvals are read directly under RLS: only shared,
  uploaded versions, non-internal comments, and approvals on versions they can see.
- **Approval workflow.**

  ```
  staff: request_approval(asset)       shares the version (if needed) + inserts a pending approval
           └─ trigger                   project → in_review, notify the client's portal users, activity
  client: decide_approval(approval)     locks the project row, records the decision
           ├─ changes_requested         next revision round (numbered under the lock), project → revisions
           └─ approved                  project → approved when nothing is pending and every round is completed
  ```

  Decisions are written only inside `decide_approval()`. The approvals trigger checks the current database role,
  which an API caller can't change. One pending approval per version (unique index). While it is pending, the version
  can't be unshared and the project can't be hidden, archived or moved to another client.

- **Portal access.** Owners, admins and managers invite client contacts from the client page. The invitation is
  bound to the client record. They can revoke invitations and remove portal users. Team invitations stay
  owner/admin-only, in RLS as well.
- **Downloads.** With `allow_client_downloads` off, `getAssetMediaUrls` issues no download link to client users,
  and the viewer hides the button. Viewing still needs a signed URL, so this doesn't stop a determined client from
  saving what they can view.

## AI generation (Phase 5)

```
signed-in staff ──▶ generateScript() (src/lib/ai/service.ts, server only)
                     1. role check + zod brief validation
                     2. not configured? → honest error, nothing reserved
                     3. start_ai_generation()   as the user  → membership + limits (DB, under locks)
                     4. Anthropic Messages API  structured output (zod schema), adaptive thinking
                     5. finish_ai_run()         with the secret key → result, model, tokens, or a safe error
```

- The Anthropic key and the Supabase secret key are read only in `server-only` modules (`src/lib/ai/config.ts`,
  `src/lib/supabase/admin.ts`). `npm run check:bundle` (also in CI) fails the build check if a secret name, the
  Anthropic SDK or a key-shaped value appears in the browser bundles.
- Users can't record or change AI results: only `finish_ai_run()`, executable by the secret-key role, writes status,
  output, model and tokens (Phase 5 database rules in [DATABASE.md](DATABASE.md)).
- The model's answer must match a JSON schema (Claude structured outputs) and is validated again with zod before it
  is stored. Refusals, truncated answers, invalid output and API errors (auth, unknown model, rate limits,
  overload, timeouts) become short, safe messages; logs record the error class, HTTP status and request ID only.
- Refusal fallback to another model is off (decision D5). The SDK retries a failed request once.

AI Studio pages (`src/app/app/ai-studio`) are staff-only server components that read through the user's RLS client.
The brief form posts to `generateScriptAction` (`src/lib/actions/ai-studio.ts`), which calls `generateScript()` and
redirects to the new script on success. Both pages set `maxDuration = 300` so the action can wait for the model.
Edits (`saveScriptDocument`), details and deletion go through the user's client, so RLS and the
`ai_generations_prepare` trigger decide who may change what (the creator or a manager; only `document`, `title` and
`project_id`). The original model output stays in `output`; edits are stored in `document`. "New version" opens the
form prefilled from the earlier run's stored brief (`?from=<id>`) and creates a separate generation. The usage
meters count `ai_usage_events` for display only; the database enforces the limits.

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
