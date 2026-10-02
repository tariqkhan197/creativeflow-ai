# Implementation roadmap

Each phase ships working, tested, production-quality features end to end: UI, Server Actions, validation, loading,
empty and error states, and RLS tests. Sidebar entries for modules that aren't built yet are shown disabled with
their phase number; they never link to empty pages.

## Phase 1 — Foundation ✅ (this release)

- [x] Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui project, ESLint, Prettier
- [x] Architecture, database, setup documentation
- [x] Complete database schema for all ten feature areas, with RLS, storage buckets and policies
- [x] Automated DB test suite (29 tests: tenant isolation, roles, client portal, invitations, approvals, invoices, storage)
- [x] Supabase SSR clients (browser / server / proxy / admin) and environment handling with honest setup states
- [x] Auth: sign-up with email confirmation, sign-in, sign-out, forgot/reset password, email link handler
- [x] Route protection via `proxy.ts`; open-redirect-safe `?next=`
- [x] Onboarding: create workspace (atomic RPC), workspace switcher
- [x] App shell: responsive sidebar (desktop + mobile sheet), top bar, theme toggle, user menu
- [x] Notifications menu (real rows, mark read / all read)
- [x] Dashboard with metrics from the database, activity feed, setup checklist, integration status
- [x] Client-role home listing shared projects
- [x] Settings: profile and workspace name
- [x] Landing page

## Phase 2 — Team, clients & projects ✅

- [x] Team page: members, role changes and removal (owner manages admins; admins manage managers/members), leave
      workspace, pending invitations with revoke
- [x] Invitations: secure one-time link (token stored as a SHA-256 hash, 7-day expiry, email must match),
      `/invite/[token]` page, sign-up / sign-in hand-off, accept via `accept_invitation`
- [x] Clients: list with search and pagination, create/edit dialog, detail page with projects, delete
- [x] Projects: list with search, status/client filters, active/archived views, pagination, task progress; create/edit
      dialog; detail page with status, archive/restore, delete and project team
- [x] Tasks: board with To do / In progress / Review / Done, create/edit, assign (staff only), due dates, move between
      columns, delete (creator or manager)
- [x] Activity log written by database triggers for every Phase 2 mutation, shown on the dashboard
- [x] Tests: 25 new DB tests (54 total, run with and without default grants), Vitest unit tests for validation,
      permissions and activity, and Phase 2 flows in `npm run verify:supabase -- --e2e`

Deliberately not in Phase 2:

- Invite emails are not sent automatically. The admin copies the one-time link and shares it. Automated email arrives
  with the notifications work in Phase 7.
- Client-role invitations (client portal access) arrive in Phase 4.
- Tasks move between columns with a status selector. Drag-and-drop ordering is not implemented.

## Phase 3 — Media & timestamped review

- Asset upload to `project-assets` (signed upload URLs, resumable upload for large video, progress, retry)
- Versions (upload new version of an asset), thumbnails/metadata extraction (duration, dimensions)
- Review player: custom video player, comment markers on the timeline, click-to-seek, frame annotations,
  threaded replies, resolve/unresolve, internal notes
- Live comments via Supabase Realtime

## Phase 4 — Client portal & approvals

- Client invitations (role `client`, bound to a client record)
- Portal experience: shared projects, review player, comment, approve / request changes (`decide_approval`)
- Staff: request approval on an asset version, track approval status, revision rounds board
- Project status automation (in review → revisions → approved)

## Phase 5 — AI Studio

- Anthropic integration (server only) with structured outputs
- Script generator from a brief (tone, duration, audience, CTA) → scenes with VO/dialogue, visuals, timing
- Storyboard generator from a script → frames with shot type, camera, description, duration
- Save to project, edit, regenerate a scene, export (PDF/CSV), history with token usage
- Per-workspace rate limiting and clear "not configured" state when `ANTHROPIC_API_KEY` is missing

## Phase 6 — Invoices & payments

- Invoice builder (line items, tax, due date), numbering, PDF export
- Send invoice (email) → Stripe Checkout Session; client pays from portal or link
- `/api/webhooks/stripe` with signature verification, idempotent payment recording
- Manual payment recording for bank transfers; transactions list; overdue detection (scheduled job)

## Phase 7 — Analytics & notifications

- Analytics dashboard from real records: project throughput, on-time delivery, average revision rounds,
  approval turnaround, revenue/outstanding by month and client, team workload
- Notification center page, preferences, email notifications (Resend/SMTP), @mentions in comments
- Triggers that create notifications for comments, approvals, assignments and payments

## Phase 8 — Hardening & launch

- End-to-end tests (Playwright) against a local Supabase (`supabase start`)
- CI (GitHub Actions): lint, typecheck, DB tests, build, e2e
- Security headers / CSP, rate limiting on auth and AI endpoints, audit of RLS policies
- Observability (error tracking, structured logs), backups, data export and account deletion
- Billing for the SaaS itself (subscription plans) if required
