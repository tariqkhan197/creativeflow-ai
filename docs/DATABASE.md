# Database schema

Source of truth: [`supabase/migrations/20261001000000_initial_schema.sql`](../supabase/migrations/20261001000000_initial_schema.sql).
TypeScript mirror: [`src/types/database.ts`](../src/types/database.ts) (regenerate with `npm run db:types` once
linked). RLS tests: [`scripts/test-db.mjs`](../scripts/test-db.mjs) (`npm run test:db`).

The whole schema ships in phase 1, so later phases add application code on top of it, not tables.

## Entity relationships

```
auth.users 1─1 profiles
auth.users 1─* workspace_members *─1 workspaces 1─1 workspace_counters
workspaces 1─* workspace_invitations
workspaces 1─* clients 1─* projects 1─* tasks
                          │        1─* project_members
                          │        1─* assets 1─* review_comments (threaded via parent_id)
                          │        │      └── versions via root_asset_id
                          │        1─* approvals 1─* revisions
                          │        1─* ai_generations
           clients 1─* invoices 1─* invoice_items
                             1─* payments
workspaces 1─* notifications (per user)
workspaces 1─* activity_log
```

## Tables

| Table                   | Purpose                                         | Key columns / rules                                                                           |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `profiles`              | Public profile per auth user                    | Created by trigger on `auth.users` insert; email kept in sync                                 |
| `workspaces`            | Tenants                                         | `slug` unique + format check; `owner_id` can't change through plain UPDATE                    |
| `workspace_members`     | User ↔ workspace with `role`                    | `client` role ⇔ `client_id` set; owner row protected; only owner grants `admin`               |
| `workspace_invitations` | Pending invites                                 | Stores **SHA-256 of the token only**; 7-day expiry; one pending invite per email              |
| `workspace_counters`    | Per-workspace sequences                         | Invoice numbers `INV-000001…` assigned by trigger                                             |
| `clients`               | Agency's client companies / contacts            |                                                                                               |
| `projects`              | Work items with status, priority, dates, budget | `client_visible` controls client-portal visibility; `archived_at` soft-archive                |
| `project_members`       | Staff assigned to a project                     | FK to `workspace_members` so only members can be assigned                                     |
| `tasks`                 | Internal production tasks                       | Never visible to clients                                                                      |
| `assets`                | Files in Storage (video, image, audio, docs)    | `storage_path` must start with `{workspace_id}/{project_id}/`; versions; `shared_with_client` |
| `review_comments`       | Timestamped review feedback                     | `timestamp_seconds`, `annotation` (x/y), threads, `is_internal`, resolve state                |
| `approvals`             | Sign-off requests                               | Decided via `decide_approval()` RPC                                                           |
| `revisions`             | Revision rounds                                 | `round_number` unique per project; auto-created on "changes requested"                        |
| `ai_generations`        | Script / storyboard generations                 | prompt, input, structured `output`, model, token usage, status, error                         |
| `invoices`              | Client invoices                                 | Totals and status maintained by triggers; clients see non-draft only                          |
| `invoice_items`         | Line items                                      | `amount_cents` generated column; editable only while invoice is draft                         |
| `payments`              | Transactions (Stripe or manual)                 | **No user write policies** — written by verified webhook with the secret key                  |
| `notifications`         | Per-user in-app notifications                   | Users may only update `read_at` (column-level grant); Realtime enabled                        |
| `activity_log`          | Append-only audit trail                         | Insert/select only                                                                            |

All money is stored as integer **cents** (`bigint`) with an ISO-4217 currency code.

## RPC functions

| Function                                          | Security | Purpose                                                                |
| ------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| `create_workspace(p_name, p_slug)`                | definer  | Atomically creates workspace + owner membership + counters + audit row |
| `accept_invitation(p_token)`                      | definer  | Validates token hash, expiry and email match; adds membership          |
| `decide_approval(p_approval, p_decision, p_note)` | definer  | Approve / request changes; creates revision round + notification       |
| `workspace_overview(p_workspace)`                 | invoker  | Dashboard metrics from real rows (finance only for managers+)          |

## Access matrix (RLS)

| Resource                 | owner/admin | manager | member            | client (bound to client X)                | other workspace |
| ------------------------ | ----------- | ------- | ----------------- | ----------------------------------------- | --------------- |
| Workspace settings       | edit        | read    | read              | read name                                 | ✗               |
| Members                  | manage      | read    | read              | read staff + self                         | ✗               |
| Invitations              | manage      | ✗       | ✗                 | ✗                                         | ✗               |
| Clients                  | CRUD        | CRUD    | read              | own record                                | ✗               |
| Projects                 | CRUD        | CRUD    | read/update       | `client_visible` projects of X            | ✗               |
| Tasks                    | CRUD        | CRUD    | CRUD (own delete) | ✗                                         | ✗               |
| Assets                   | CRUD        | CRUD    | upload/update     | shared + ready assets of visible projects | ✗               |
| Comments                 | all         | all     | all               | non-internal; can post non-internal       | ✗               |
| Approvals                | all         | all     | request           | read + decide via RPC                     | ✗               |
| AI generations           | all         | all     | own               | ✗                                         | ✗               |
| Invoices / items         | CRUD        | CRUD    | ✗                 | non-draft invoices for X                  | ✗               |
| Payments                 | read        | read    | ✗                 | read for own invoices                     | ✗               |
| Notifications            | own         | own     | own               | own                                       | ✗               |
| Storage `project-assets` | all         | all     | upload            | download shared assets                    | ✗               |

## Storage buckets

| Bucket           | Public | Limit | Path convention                                 |
| ---------------- | ------ | ----- | ----------------------------------------------- |
| `project-assets` | no     | 5 GB  | `{workspace_id}/{project_id}/{asset_id}/{file}` |
| `avatars`        | no     | 5 MB  | `{user_id}/{file}`                              |

## Migrations workflow

- Never edit an applied migration. Add a new file: `npx supabase migration new <name>`.
- Run `npm run test:db` after every schema change; add a test for every new policy.
- After pushing, regenerate types: `npm run db:types`.
