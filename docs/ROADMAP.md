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

## Phase 3 — Media & timestamped review ✅ (complete)

- [x] Secure uploads: the asset record is created server-side first, then direct browser → Storage resumable (TUS)
      upload in 6 MB chunks with progress, pause/resume, retry on the same record, cancel with storage cleanup, and
      resume after an interrupted session
- [x] Validation: MIME/extension allowlist (app, database and bucket), server-built storage paths, real size limit
      (bucket limit plus optional `STORAGE_MAX_UPLOAD_BYTES`), finalization only after the database verifies the
      stored object's exact size and type
- [x] Versions: numbered by the database under a row lock, linked to the original and project; version history and
      switcher; deleting removes every version's files and thumbnails before the records
- [x] Metadata and thumbnails measured in the browser from the real file (duration, dimensions, frame rate, JPEG
      thumbnail). Anything unreadable stays empty and is reported honestly
- [x] Review page: custom video player (markers, click-to-seek, timecode, frame stepping, speed, shortcuts, frame
      pins), image pins, audio timeline comments, PDF viewer, signed-URL refresh, unsupported-format and error states
      with secure download
- [x] Comments: timestamps, pins, one-level threads, author-only edits (`edited_at`), delete, resolve/unresolve,
      internal notes, open/resolved/all filters
- [x] Supabase Realtime live comments (RLS per subscriber, de-duplication, re-sync after reconnect)
- [x] Reviews page, activity entries, project deletion empties Storage first
- [x] Tests: 28 new DB tests (82 total, both grant modes), unit and integration tests (125, including a real TUS
      server), 37 browser checks of the review UI, and Phase 3 flows in `verify:supabase -- --e2e`
- [x] Verified on the real Supabase project:
  - `verify:supabase -- --e2e`: 64 passed, 1 warning (optional `STORAGE_MAX_UPLOAD_BYTES` not set), 0 failed.
    This followed the Realtime fix that waits for server confirmation of the `postgres_changes` subscription.
  - All 10 steps of the manual browser checklist in `docs/TESTING.md` passed.

Limitations, by design or deferred:

- No video conversion. Formats the browser can't decode are stored and offered as secure downloads.
- Thumbnails and metadata come from the uploader's browser. If that browser can't decode the file, they are left
  empty.
- Client-role review UI (portal), approvals and sharing toggles arrive in Phase 4. The RLS rules are already in
  place and tested.
- New-comment notifications are deferred to Phase 7.
- Realtime DELETE events carry only the comment id (a Supabase limitation). Ids are random UUIDs, and no content is
  sent.

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
