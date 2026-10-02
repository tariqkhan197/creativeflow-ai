#!/usr/bin/env node
/**
 * Database migration + Row Level Security test suite.
 *
 * Runs every migration in supabase/migrations against an in-process Postgres
 * (PGlite) that stubs the parts of Supabase the schema depends on (auth.users,
 * auth.uid(), storage.objects, the anon/authenticated roles), then exercises
 * the tenant-isolation and role rules as real database users would.
 *
 * Usage: npm run test:db
 */
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text not null,
    owner uuid,
    owner_id text,
    metadata jsonb
  );
  alter table storage.objects enable row level security;
  grant all on storage.objects to authenticated;
`;

// Supabase projects normally grant table privileges to the API roles by
// default, but "automatic grants" can be switched off. Run with
// --no-default-grants to verify the migrations work either way.
const DEFAULT_GRANTS = process.argv.includes("--no-default-grants")
  ? ""
  : `
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const db = new PGlite();
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
}

/** Run `fn` as a signed-in user (or as anon when uid is null), inside a rolled-back-on-error transaction. */
async function as(uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ""]);
    await tx.exec(`set local role ${uid ? "authenticated" : "anon"}`);
    return fn(tx);
  });
}

async function rejects(promise, pattern) {
  await assert.rejects(promise, pattern);
}

async function createUser(email, fullName) {
  const { rows } = await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [
    email,
    { full_name: fullName },
  ]);
  return rows[0].id;
}

/**
 * Real upload sequence as the app performs it: create the asset row
 * (uploading), write the storage object (as the uploader, through RLS), then
 * finalize via the RPC that checks the stored object.
 */
async function uploadAsset(uid, ws, project, opts = {}) {
  const { randomUUID } = await import("node:crypto");
  const id = randomUUID();
  const mime = opts.mime ?? "video/mp4";
  const size = opts.size ?? 1024;
  const file = opts.file ?? "cut.mp4";
  const path = `${ws}/${project}/${id}/${file}`;
  await as(uid, (tx) =>
    tx.query(
      `insert into public.assets (id, workspace_id, project_id, name, kind, storage_path, mime_type, size_bytes, uploaded_by, root_asset_id)
       values ($1, $2, $3, $4, private.asset_kind_for_mime($5), $6, $5, $7, $8, $9)`,
      [id, ws, project, opts.name ?? file, mime, path, size, uid, opts.root ?? null],
    ),
  );
  await as(uid, (tx) =>
    tx.query(
      `insert into storage.objects (bucket_id, name, owner_id, metadata) values ('project-assets', $1, $2, $3)`,
      [path, uid, { size: opts.storedSize ?? size, mimetype: mime }],
    ),
  );
  if (opts.thumbnail) {
    await as(uid, (tx) =>
      tx.query(
        `insert into storage.objects (bucket_id, name, owner_id, metadata) values ('project-assets', $1, $2, $3)`,
        [`${ws}/${project}/${id}/thumbnail.jpg`, uid, { size: 100, mimetype: "image/jpeg" }],
      ),
    );
  }
  if (opts.finalize !== false) {
    await as(uid, (tx) =>
      tx.query(`select public.finalize_asset_upload($1, $2, $3, $4, $5)`, [
        id,
        opts.duration ?? null,
        opts.width ?? null,
        opts.height ?? null,
        opts.fps ?? null,
      ]),
    );
  }
  return { id, path };
}

async function main() {
  await db.exec(SUPABASE_STUBS + DEFAULT_GRANTS);
  console.log(`Default API grants: ${DEFAULT_GRANTS ? "on" : "off"}`);

  const dir = path.join(root, "supabase", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(await readFile(path.join(dir, file), "utf8"));
    console.log(`Applied ${file}`);
  }

  const alice = await createUser("alice@agency-a.test", "Alice");
  const bob = await createUser("bob@agency-b.test", "Bob");
  const carol = await createUser("carol@agency-a.test", "Carol");
  const dana = await createUser("dana@client.test", "Dana");

  console.log("\nAuth & profiles");
  await test("new auth users get a profile", async () => {
    const { rows } = await db.query(`select full_name from public.profiles where id = $1`, [alice]);
    assert.equal(rows[0].full_name, "Alice");
  });

  console.log("\nWorkspaces");
  let wsA, wsB;
  await test("create_workspace makes the caller owner", async () => {
    wsA = await as(
      alice,
      async (tx) => (await tx.query(`select public.create_workspace('Agency A', 'agency-a') as id`)).rows[0].id,
    );
    wsB = await as(
      bob,
      async (tx) => (await tx.query(`select public.create_workspace('Agency B', 'agency-b') as id`)).rows[0].id,
    );
    const { rows } = await db.query(
      `select role from public.workspace_members where workspace_id = $1 and user_id = $2`,
      [wsA, alice],
    );
    assert.equal(rows[0].role, "owner");
  });

  await test("anon cannot call create_workspace", () =>
    rejects(
      as(null, (tx) => tx.query(`select public.create_workspace('X', 'xx-yy')`)),
      /permission denied/,
    ));

  await test("invalid slugs are rejected", () =>
    rejects(
      as(alice, (tx) => tx.query(`select public.create_workspace('Bad', 'Bad Slug!')`)),
      /workspaces_slug_check/,
    ));

  await test("users only see their own workspaces", async () => {
    const rows = await as(alice, async (tx) => (await tx.query(`select id from public.workspaces`)).rows);
    assert.deepEqual(
      rows.map((r) => r.id),
      [wsA],
    );
  });

  await test("users cannot insert memberships directly", () =>
    rejects(
      as(bob, (tx) =>
        tx.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'member')`, [
          wsA,
          bob,
        ]),
      ),
      /row-level security/,
    ));

  await test("workspace ownership cannot be changed by UPDATE", () =>
    rejects(
      as(alice, (tx) => tx.query(`update public.workspaces set owner_id = $1 where id = $2`, [carol, wsA])),
      /ownership cannot be changed/,
    ));

  await test("the owner cannot be removed", () =>
    rejects(
      as(alice, (tx) =>
        tx.query(`delete from public.workspace_members where workspace_id = $1 and user_id = $2`, [wsA, alice]),
      ),
      /owner cannot be removed/,
    ));

  console.log("\nInvitations");
  const crypto = await import("node:crypto");
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  await test("admins can invite; the invitee accepts with the raw token", async () => {
    await as(alice, (tx) =>
      tx.query(
        `insert into public.workspace_invitations (workspace_id, email, role, token_hash, invited_by)
         values ($1, 'carol@agency-a.test', 'manager', $2, $3)`,
        [wsA, tokenHash, alice],
      ),
    );
    const ws = await as(
      carol,
      async (tx) => (await tx.query(`select public.accept_invitation($1) as id`, [token])).rows[0].id,
    );
    assert.equal(ws, wsA);
  });

  await test("an invitation cannot be reused", () =>
    rejects(
      as(bob, (tx) => tx.query(`select public.accept_invitation($1)`, [token])),
      /invalid or has expired/,
    ));

  await test("non-members cannot read invitations", async () => {
    const rows = await as(bob, async (tx) => (await tx.query(`select * from public.workspace_invitations`)).rows);
    assert.equal(rows.length, 0);
  });

  console.log("\nProjects & client portal");
  let clientId, projectId, hiddenProjectId;
  await test("managers create clients and projects", async () => {
    clientId = await as(
      carol,
      async (tx) =>
        (
          await tx.query(
            `insert into public.clients (workspace_id, name, created_by) values ($1, 'Acme', $2) returning id`,
            [wsA, carol],
          )
        ).rows[0].id,
    );
    projectId = await as(
      carol,
      async (tx) =>
        (
          await tx.query(
            `insert into public.projects (workspace_id, client_id, name, client_visible, created_by)
         values ($1, $2, 'Launch film', true, $3) returning id`,
            [wsA, clientId, carol],
          )
        ).rows[0].id,
    );
    hiddenProjectId = await as(
      carol,
      async (tx) =>
        (
          await tx.query(
            `insert into public.projects (workspace_id, client_id, name, created_by)
         values ($1, $2, 'Internal pitch', $3) returning id`,
            [wsA, clientId, carol],
          )
        ).rows[0].id,
    );
  });

  await test("other agencies cannot see or modify projects", async () => {
    const rows = await as(bob, async (tx) => (await tx.query(`select id from public.projects`)).rows);
    assert.equal(rows.length, 0);
    const res = await as(bob, (tx) => tx.query(`update public.projects set name = 'pwned' where id = $1`, [projectId]));
    assert.equal(res.affectedRows, 0);
  });

  await test("a project cannot reference another workspace's client", () =>
    rejects(
      as(bob, (tx) =>
        tx.query(
          `insert into public.projects (workspace_id, client_id, name, created_by) values ($1, $2, 'x project', $3)`,
          [wsB, clientId, bob],
        ),
      ),
      /foreign key/,
    ));

  await test("client users see only client-visible projects of their own client", async () => {
    const t2 = crypto.randomBytes(32).toString("base64url");
    await as(alice, (tx) =>
      tx.query(
        `insert into public.workspace_invitations (workspace_id, email, role, client_id, token_hash, invited_by)
         values ($1, 'dana@client.test', 'client', $2, $3, $4)`,
        [wsA, clientId, crypto.createHash("sha256").update(t2).digest("hex"), alice],
      ),
    );
    await as(dana, (tx) => tx.query(`select public.accept_invitation($1)`, [t2]));
    // Phase 4 (G1): clients read projects through portal_projects() only.
    const rows = await as(
      dana,
      async (tx) => (await tx.query(`select id from public.portal_projects($1)`, [wsA])).rows,
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      [projectId],
    );
    assert.ok(!rows.some((r) => r.id === hiddenProjectId));
    const direct = await as(dana, async (tx) => (await tx.query(`select id from public.projects`)).rows);
    assert.equal(direct.length, 0);
  });

  await test("client users cannot read tasks or AI generations", async () => {
    await as(carol, (tx) =>
      tx.query(`insert into public.tasks (workspace_id, project_id, title, created_by) values ($1, $2, 'Edit', $3)`, [
        wsA,
        projectId,
        carol,
      ]),
    );
    const rows = await as(dana, async (tx) => (await tx.query(`select * from public.tasks`)).rows);
    assert.equal(rows.length, 0);
  });

  await test("client users cannot see other members' client records", async () => {
    // Phase 4 (G1): not even their own record (it holds the agency's private notes).
    const rows = await as(dana, async (tx) => (await tx.query(`select id from public.clients`)).rows);
    assert.equal(rows.length, 0);
  });

  await test("workspace_overview is denied to clients and outsiders", async () => {
    await rejects(
      as(dana, (tx) => tx.query(`select public.workspace_overview($1)`, [wsA])),
      /Not a member/,
    );
    await rejects(
      as(bob, (tx) => tx.query(`select public.workspace_overview($1)`, [wsA])),
      /Not a member/,
    );
    const overview = await as(
      alice,
      async (tx) => (await tx.query(`select public.workspace_overview($1) as o`, [wsA])).rows[0].o,
    );
    assert.equal(overview.active_projects, 2);
    assert.equal(overview.clients, 1);
    assert.equal(overview.members, 2);
  });

  console.log("\nAssets, review comments & approvals");
  let assetId, approvalId;
  await test("unshared assets are hidden from clients", async () => {
    ({ id: assetId } = await uploadAsset(carol, wsA, projectId, { file: "cut-v1.mp4", duration: 30 }));
    const rows = await as(dana, async (tx) => (await tx.query(`select id from public.assets`)).rows);
    assert.equal(rows.length, 0);
  });

  await test("clients comment on shared assets; internal notes stay internal", async () => {
    await as(carol, (tx) => tx.query(`update public.assets set shared_with_client = true where id = $1`, [assetId]));
    await as(carol, (tx) =>
      tx.query(
        `insert into public.review_comments (workspace_id, asset_id, author_id, body, timestamp_seconds, is_internal)
         values ($1, $2, $3, 'Fix colour grade before sending', 12.5, true)`,
        [wsA, assetId, carol],
      ),
    );
    await as(dana, (tx) =>
      tx.query(
        `insert into public.review_comments (workspace_id, asset_id, author_id, body, timestamp_seconds)
         values ($1, $2, $3, 'Logo is too small here', 4.2)`,
        [wsA, assetId, dana],
      ),
    );
    const rows = await as(dana, async (tx) => (await tx.query(`select body from public.review_comments`)).rows);
    assert.deepEqual(
      rows.map((r) => r.body),
      ["Logo is too small here"],
    );
    await rejects(
      as(dana, (tx) =>
        tx.query(
          `insert into public.review_comments (workspace_id, asset_id, author_id, body, is_internal)
           values ($1, $2, $3, 'sneaky', true)`,
          [wsA, assetId, dana],
        ),
      ),
      /row-level security/,
    );
  });

  await test("client requests changes → revision round is created", async () => {
    approvalId = await as(
      carol,
      async (tx) =>
        (
          await tx.query(
            `insert into public.approvals (workspace_id, project_id, asset_id, title, requested_by)
         values ($1, $2, $3, 'Cut v1', $4) returning id`,
            [wsA, projectId, assetId, carol],
          )
        ).rows[0].id,
    );
    await rejects(
      as(dana, (tx) =>
        tx
          .query(`update public.approvals set status = 'approved' where id = $1 returning id`, [approvalId])
          .then((r) => {
            if (r.rows.length === 0) throw new Error("row-level security blocked update");
          }),
      ),
      /row-level security/,
    );
    await as(dana, (tx) =>
      tx.query(`select public.decide_approval($1, 'changes_requested', 'Bigger logo please')`, [approvalId]),
    );
    const { rows } = await db.query(`select round_number, summary from public.revisions where project_id = $1`, [
      projectId,
    ]);
    assert.equal(rows[0].round_number, 1);
    const notes = await as(carol, async (tx) => (await tx.query(`select type from public.notifications`)).rows);
    assert.deepEqual(
      notes.map((n) => n.type),
      ["approval.changes_requested"],
    );
  });

  await test("outsiders cannot decide approvals", () =>
    rejects(
      as(bob, (tx) => tx.query(`select public.decide_approval($1, 'approved')`, [approvalId])),
      /not found/,
    ));

  console.log("\nInvoices & payments");
  let invoiceId;
  await test("invoice numbers are sequential per workspace and totals are computed", async () => {
    invoiceId = await as(
      alice,
      async (tx) =>
        (
          await tx.query(
            `insert into public.invoices (workspace_id, client_id, project_id, number, tax_rate_bps, created_by)
         values ($1, $2, $3, '', 1000, $4) returning id`,
            [wsA, clientId, projectId, alice],
          )
        ).rows[0].id,
    );
    await as(alice, (tx) =>
      tx.query(
        `insert into public.invoice_items (workspace_id, invoice_id, description, quantity, unit_price_cents)
         values ($1, $2, 'Edit', 2, 50000), ($1, $2, 'Grade', 1, 25000)`,
        [wsA, invoiceId],
      ),
    );
    const { rows } = await db.query(`select number, subtotal_cents, tax_cents, total_cents from public.invoices`);
    assert.equal(rows[0].number, "INV-000001");
    assert.equal(Number(rows[0].subtotal_cents), 125000);
    assert.equal(Number(rows[0].tax_cents), 12500);
    assert.equal(Number(rows[0].total_cents), 137500);
  });

  await test("clients cannot see draft invoices, then see them once sent", async () => {
    let rows = await as(dana, async (tx) => (await tx.query(`select id from public.invoices`)).rows);
    assert.equal(rows.length, 0);
    await as(alice, (tx) => tx.query(`update public.invoices set status = 'sent' where id = $1`, [invoiceId]));
    rows = await as(dana, async (tx) => (await tx.query(`select id from public.invoices`)).rows);
    assert.equal(rows.length, 1);
  });

  await test("users cannot record payments directly", () =>
    rejects(
      as(alice, (tx) =>
        tx.query(
          `insert into public.payments (workspace_id, invoice_id, amount_cents, currency, status)
           values ($1, $2, 137500, 'USD', 'succeeded')`,
          [wsA, invoiceId],
        ),
      ),
      /row-level security/,
    ));

  await test("a succeeded payment (service role) marks the invoice paid", async () => {
    await db.query(
      `insert into public.payments (workspace_id, invoice_id, provider_payment_id, amount_cents, currency, status, paid_at)
       values ($1, $2, 'pi_test_1', 137500, 'USD', 'succeeded', now())`,
      [wsA, invoiceId],
    );
    const { rows } = await db.query(`select status, amount_paid_cents from public.invoices where id = $1`, [invoiceId]);
    assert.equal(rows[0].status, "paid");
    assert.equal(Number(rows[0].amount_paid_cents), 137500);
  });

  await test("members (non-managers) cannot read invoices", async () => {
    const rows = await as(bob, async (tx) => (await tx.query(`select id from public.invoices`)).rows);
    assert.equal(rows.length, 0);
  });

  console.log("\nNotifications");
  await test("users can only mark their own notifications read and cannot edit content", async () => {
    await rejects(
      as(carol, (tx) => tx.query(`update public.notifications set title = 'changed'`)),
      /permission denied/,
    );
    const res = await as(alice, (tx) => tx.query(`update public.notifications set read_at = now()`));
    assert.equal(res.affectedRows, 0);
  });

  console.log("\nStorage");
  await test("uploads require a matching in-progress asset (no free-form paths)", async () => {
    await rejects(
      as(carol, (tx) =>
        tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', $1, $2)`, [
          `${wsA}/${projectId}/x/file.mp4`,
          carol,
        ]),
      ),
      /row-level security/,
    );
    await rejects(
      as(bob, (tx) =>
        tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', $1, $2)`, [
          `${wsA}/${projectId}/x/evil.mp4`,
          bob,
        ]),
      ),
      /row-level security/,
    );
  });

  /* ======================================================================== */
  /* Phase 2: team, clients, projects & tasks                                 */
  /* ======================================================================== */

  const newToken = () => crypto.randomBytes(32).toString("base64url");
  const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");
  async function inviteAndAccept(inviter, ws, email, role, invitee) {
    const t = newToken();
    await as(inviter, (tx) =>
      tx.query(
        `insert into public.workspace_invitations (workspace_id, email, role, token_hash, invited_by) values ($1, $2, $3, $4, $5)`,
        [ws, email, role, hashToken(t), inviter],
      ),
    );
    await as(invitee, (tx) => tx.query(`select public.accept_invitation($1)`, [t]));
  }
  const activity = async (ws, action) =>
    (
      await db.query(
        `select actor_id, metadata from public.activity_log where workspace_id = $1 and action = $2 order by id`,
        [ws, action],
      )
    ).rows;

  const erin = await createUser("erin@agency-a.test", "Erin");
  const frank = await createUser("frank@agency-a.test", "Frank");

  console.log("\nPhase 2 · Invitations");
  let erinToken;
  await test("get_invitation shows a pending invite to anyone holding the link", async () => {
    erinToken = newToken();
    await as(alice, (tx) =>
      tx.query(
        `insert into public.workspace_invitations (workspace_id, email, role, token_hash, invited_by) values ($1, 'erin@agency-a.test', 'member', $2, $3)`,
        [wsA, hashToken(erinToken), alice],
      ),
    );
    const info = await as(
      null,
      async (tx) => (await tx.query(`select public.get_invitation($1) as i`, [erinToken])).rows[0].i,
    );
    assert.equal(info.workspace_name, "Agency A");
    assert.equal(info.role, "member");
    assert.equal(info.status, "pending");
    assert.equal(info.inviter_name, "Alice");
  });

  await test("get_invitation returns nothing for an unknown or malformed token", async () => {
    const a = await as(
      null,
      async (tx) => (await tx.query(`select public.get_invitation($1) as i`, [newToken()])).rows[0].i,
    );
    const b = await as(null, async (tx) => (await tx.query(`select public.get_invitation('x') as i`)).rows[0].i);
    assert.equal(a, null);
    assert.equal(b, null);
  });

  await test("accepting marks the invite accepted and logs invitation.created", async () => {
    await as(erin, (tx) => tx.query(`select public.accept_invitation($1)`, [erinToken]));
    const info = await as(
      erin,
      async (tx) => (await tx.query(`select public.get_invitation($1) as i`, [erinToken])).rows[0].i,
    );
    assert.equal(info.status, "accepted");
    const logs = await activity(wsA, "invitation.created");
    assert.ok(logs.some((l) => l.metadata.email === "erin@agency-a.test" && l.actor_id === alice));
  });

  await test("expired invitations report expired and cannot be accepted", async () => {
    const t = newToken();
    await as(alice, (tx) =>
      tx.query(
        `insert into public.workspace_invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
         values ($1, 'late@agency-a.test', 'member', $2, $3, now() - interval '1 day')`,
        [wsA, hashToken(t), alice],
      ),
    );
    const info = await as(null, async (tx) => (await tx.query(`select public.get_invitation($1) as i`, [t])).rows[0].i);
    assert.equal(info.status, "expired");
  });

  await test("revoking a pending invitation logs invitation.revoked", async () => {
    await as(alice, (tx) => tx.query(`delete from public.workspace_invitations where email = 'late@agency-a.test'`));
    const logs = await activity(wsA, "invitation.revoked");
    assert.equal(logs.at(-1).metadata.email, "late@agency-a.test");
  });

  await test("managers cannot invite (admins only)", () =>
    rejects(
      as(carol, (tx) =>
        tx.query(
          `insert into public.workspace_invitations (workspace_id, email, role, token_hash, invited_by) values ($1, 'x@y.test', 'member', $2, $3)`,
          [wsA, hashToken(newToken()), carol],
        ),
      ),
      /row-level security/,
    ));

  console.log("\nPhase 2 · Roles");
  await test("owner invites an admin; admins cannot grant admin", async () => {
    await inviteAndAccept(alice, wsA, "frank@agency-a.test", "admin", frank);
    await rejects(
      as(frank, (tx) =>
        tx.query(`update public.workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2`, [
          wsA,
          erin,
        ]),
      ),
      /Only the workspace owner can grant the admin role/,
    );
  });

  await test("admins change non-admin roles; the change is logged", async () => {
    await as(frank, (tx) =>
      tx.query(`update public.workspace_members set role = 'manager' where workspace_id = $1 and user_id = $2`, [
        wsA,
        erin,
      ]),
    );
    const logs = await activity(wsA, "member.role_changed");
    assert.deepEqual(logs.at(-1).metadata, { from: "member", to: "manager" });
    assert.equal(logs.at(-1).actor_id, frank);
  });

  await test("only the owner can demote or remove an admin", async () => {
    await as(alice, (tx) =>
      tx.query(`update public.workspace_members set role = 'admin' where workspace_id = $1 and user_id = $2`, [
        wsA,
        erin,
      ]),
    );
    await rejects(
      as(frank, (tx) =>
        tx.query(`update public.workspace_members set role = 'member' where workspace_id = $1 and user_id = $2`, [
          wsA,
          erin,
        ]),
      ),
      /Only the workspace owner can change an admin/,
    );
    await rejects(
      as(frank, (tx) =>
        tx.query(`delete from public.workspace_members where workspace_id = $1 and user_id = $2`, [wsA, erin]),
      ),
      /Only the workspace owner can remove an admin/,
    );
    await as(alice, (tx) =>
      tx.query(`update public.workspace_members set role = 'member' where workspace_id = $1 and user_id = $2`, [
        wsA,
        erin,
      ]),
    );
  });

  await test("members cannot change roles", async () => {
    const res = await as(erin, (tx) =>
      tx.query(`update public.workspace_members set role = 'manager' where workspace_id = $1 and user_id = $2`, [
        wsA,
        erin,
      ]),
    );
    assert.equal(res.affectedRows, 0);
  });

  await test("other agencies cannot see members or activity", async () => {
    const members = await as(
      bob,
      async (tx) => (await tx.query(`select * from public.workspace_members where workspace_id = $1`, [wsA])).rows,
    );
    const logs = await as(
      bob,
      async (tx) => (await tx.query(`select * from public.activity_log where workspace_id = $1`, [wsA])).rows,
    );
    assert.equal(members.length, 0);
    assert.equal(logs.length, 0);
  });

  await test("deleting a workspace with an admin still cascades cleanly", async () => {
    const tmp = await as(
      alice,
      async (tx) => (await tx.query(`select public.create_workspace('Temp WS', 'temp-ws') as id`)).rows[0].id,
    );
    await inviteAndAccept(alice, tmp, "frank@agency-a.test", "admin", frank);
    await as(alice, (tx) => tx.query(`delete from public.workspaces where id = $1`, [tmp]));
    const { rows } = await db.query(`select count(*)::int as n from public.workspace_members where workspace_id = $1`, [
      tmp,
    ]);
    assert.equal(rows[0].n, 0);
  });

  console.log("\nPhase 2 · Clients");
  let client2;
  await test("members cannot create clients; managers can and it is logged", async () => {
    await rejects(
      as(erin, (tx) =>
        tx.query(`insert into public.clients (workspace_id, name, created_by) values ($1, 'Nope', $2)`, [wsA, erin]),
      ),
      /row-level security/,
    );
    client2 = await as(
      carol,
      async (tx) =>
        (
          await tx.query(
            `insert into public.clients (workspace_id, name, email, created_by) values ($1, 'Globex', 'ops@globex.test', $2) returning id`,
            [wsA, carol],
          )
        ).rows[0].id,
    );
    const logs = await activity(wsA, "client.created");
    assert.ok(logs.some((l) => l.metadata.name === "Globex" && l.actor_id === carol));
  });

  await test("client email format is validated by the database", () =>
    rejects(
      as(carol, (tx) =>
        tx.query(
          `insert into public.clients (workspace_id, name, email, created_by) values ($1, 'Bad', 'not-an-email', $2)`,
          [wsA, carol],
        ),
      ),
      /clients_email_check/,
    ));

  await test("other agencies cannot read, update or delete clients", async () => {
    const rows = await as(
      bob,
      async (tx) => (await tx.query(`select id from public.clients where id = $1`, [client2])).rows,
    );
    const upd = await as(bob, (tx) => tx.query(`update public.clients set name = 'x' where id = $1`, [client2]));
    const del = await as(bob, (tx) => tx.query(`delete from public.clients where id = $1`, [client2]));
    assert.equal(rows.length + upd.affectedRows + del.affectedRows, 0);
  });

  console.log("\nPhase 2 · Projects");
  let project2;
  await test("project create, status change and archive are logged", async () => {
    project2 = await as(
      carol,
      async (tx) =>
        (
          await tx.query(
            `insert into public.projects (workspace_id, client_id, name, created_by, budget_cents, due_date) values ($1, $2, 'Spring campaign', $3, 1500000, current_date + 30) returning id`,
            [wsA, client2, carol],
          )
        ).rows[0].id,
    );
    await as(erin, (tx) => tx.query(`update public.projects set status = 'in_progress' where id = $1`, [project2]));
    await as(carol, (tx) => tx.query(`update public.projects set archived_at = now() where id = $1`, [project2]));
    await as(carol, (tx) => tx.query(`update public.projects set archived_at = null where id = $1`, [project2]));
    assert.ok((await activity(wsA, "project.created")).some((l) => l.metadata.name === "Spring campaign"));
    const changed = (await activity(wsA, "project.status_changed")).at(-1);
    assert.deepEqual([changed.metadata.from, changed.metadata.to, changed.actor_id], ["planning", "in_progress", erin]);
    assert.equal((await activity(wsA, "project.archived")).length, 1);
    assert.equal((await activity(wsA, "project.restored")).length, 1);
  });

  await test("members can update but not create or delete projects", async () => {
    await rejects(
      as(erin, (tx) =>
        tx.query(`insert into public.projects (workspace_id, name, created_by) values ($1, 'Nope', $2)`, [wsA, erin]),
      ),
      /row-level security/,
    );
    const del = await as(erin, (tx) => tx.query(`delete from public.projects where id = $1`, [project2]));
    assert.equal(del.affectedRows, 0);
  });

  await test("due date cannot be before start date", () =>
    rejects(
      as(carol, (tx) =>
        tx.query(`update public.projects set start_date = current_date, due_date = current_date - 1 where id = $1`, [
          project2,
        ]),
      ),
      /projects_check/,
    ));

  await test("only staff can be assigned to a project team", async () => {
    await as(carol, (tx) =>
      tx.query(`insert into public.project_members (project_id, workspace_id, user_id) values ($1, $2, $3)`, [
        project2,
        wsA,
        erin,
      ]),
    );
    await rejects(
      as(carol, (tx) =>
        tx.query(`insert into public.project_members (project_id, workspace_id, user_id) values ($1, $2, $3)`, [
          project2,
          wsA,
          dana,
        ]),
      ),
      /Only team members/,
    );
    await rejects(
      as(carol, (tx) =>
        tx.query(`insert into public.project_members (project_id, workspace_id, user_id) values ($1, $2, $3)`, [
          project2,
          wsA,
          bob,
        ]),
      ),
      /Only team members|foreign key/,
    );
  });

  console.log("\nPhase 2 · Tasks");
  const addTask = (uid, title, extra = {}) =>
    as(
      uid,
      async (tx) =>
        (
          await tx.query(
            `insert into public.tasks (workspace_id, project_id, title, created_by, assignee_id, status)
         values ($1, $2, $3, $4, $5, coalesce($6, 'todo')::public.task_status) returning id, position, completed_at`,
            [wsA, project2, title, uid, extra.assignee ?? null, extra.status ?? null],
          )
        ).rows[0],
    );

  await test("new tasks go to the end of their column", async () => {
    const t1 = await addTask(erin, "Write brief");
    const t2 = await addTask(erin, "Book crew");
    assert.equal(t1.position, 0);
    assert.equal(t2.position, 1);
  });

  await test("assignees must be staff of the same workspace", async () => {
    await addTask(carol, "Edit cut", { assignee: erin });
    await rejects(addTask(carol, "Client task", { assignee: dana }), /assignee must be a team member/);
    await rejects(addTask(carol, "Outsider task", { assignee: bob }), /assignee must be a team member/);
  });

  await test("completing a task sets completed_at and logs it; reopening clears it", async () => {
    const t = await addTask(erin, "Colour grade");
    const done = await as(
      erin,
      async (tx) =>
        (
          await tx.query(`update public.tasks set status = 'done' where id = $1 returning completed_at, position`, [
            t.id,
          ])
        ).rows[0],
    );
    assert.ok(done.completed_at);
    assert.equal(done.position, 0);
    const reopened = await as(
      erin,
      async (tx) =>
        (await tx.query(`update public.tasks set status = 'todo' where id = $1 returning completed_at`, [t.id]))
          .rows[0],
    );
    assert.equal(reopened.completed_at, null);
    assert.ok((await activity(wsA, "task.completed")).some((l) => l.metadata.title === "Colour grade"));
  });

  await test("other agencies cannot read or add tasks to this workspace", async () => {
    const rows = await as(
      bob,
      async (tx) => (await tx.query(`select id from public.tasks where project_id = $1`, [project2])).rows,
    );
    assert.equal(rows.length, 0);
    await rejects(
      as(bob, (tx) =>
        tx.query(`insert into public.tasks (workspace_id, project_id, title, created_by) values ($1, $2, 'x', $3)`, [
          wsA,
          project2,
          bob,
        ]),
      ),
      /row-level security/,
    );
    await rejects(
      as(bob, (tx) =>
        tx.query(`insert into public.tasks (workspace_id, project_id, title, created_by) values ($1, $2, 'x', $3)`, [
          wsB,
          project2,
          bob,
        ]),
      ),
      /foreign key/,
    );
  });

  await test("members leave on their own; the departure is logged", async () => {
    await as(frank, (tx) =>
      tx.query(`delete from public.workspace_members where workspace_id = $1 and user_id = $2`, [wsA, frank]),
    );
    assert.equal((await activity(wsA, "member.left")).at(-1)?.actor_id, frank);
  });

  /* ======================================================================== */
  /* Phase 3: media uploads, versions, review comments                         */
  /* ======================================================================== */
  const { randomUUID } = await import("node:crypto");
  const insertAsset = (uid, fields) =>
    as(uid, (tx) =>
      tx.query(
        `insert into public.assets (id, workspace_id, project_id, name, kind, status, storage_path, mime_type, size_bytes, uploaded_by, root_asset_id)
         values ($1, $2, $3, 'x', coalesce($4, 'video')::public.asset_kind, coalesce($5, 'uploading')::public.asset_status, $6, $7, $8, $9, $10)`,
        [
          fields.id,
          fields.ws ?? wsA,
          fields.project ?? project2,
          fields.kind ?? null,
          fields.status ?? null,
          fields.path,
          fields.mime ?? "video/mp4",
          fields.size ?? 100,
          uid,
          fields.root ?? null,
        ],
      ),
    );
  const putObject = (uid, name, meta = { size: 100, mimetype: "video/mp4" }) =>
    as(uid, (tx) =>
      tx.query(
        `insert into storage.objects (bucket_id, name, owner_id, metadata) values ('project-assets', $1, $2, $3)`,
        [name, uid, meta],
      ),
    );
  const finalize = (uid, id, ...meta) =>
    as(
      uid,
      async (tx) =>
        (
          await tx.query(`select public.finalize_asset_upload($1, $2, $3, $4, $5) as r`, [
            id,
            ...[0, 1, 2, 3].map((i) => meta[i] ?? null),
          ])
        ).rows[0].r,
    );
  const assetRow = async (id) => (await db.query(`select * from public.assets where id = $1`, [id])).rows[0];

  console.log("\nPhase 3 · Asset records");
  await test("new assets must start as uploading with a server-shaped path", async () => {
    const id = randomUUID();
    await rejects(
      insertAsset(carol, { id, status: "ready", path: `${wsA}/${project2}/${id}/a.mp4` }),
      /must start in the uploading state/,
    );
    await rejects(insertAsset(carol, { id, path: `${wsA}/${project2}/${randomUUID()}/a.mp4` }), /Invalid storage path/);
    await rejects(insertAsset(carol, { id, path: `${wsA}/${project2}/${id}/sub/a.mp4` }), /Invalid storage path/);
    await rejects(insertAsset(carol, { id, path: `${wsA}/${project2}/${id}/thumbnail.jpg` }), /Invalid storage path/);
    await rejects(insertAsset(carol, { id, path: `${wsA}/${project2}/${id}/../../x.mp4` }), /Invalid storage path/);
    await rejects(
      insertAsset(carol, { id, path: `${wsA}/${projectId}/${id}/a.mp4` }),
      /Invalid storage path|assets_check/,
    );
  });

  await test("unsupported MIME types, empty files and over-limit sizes are rejected", async () => {
    const id = randomUUID();
    const path = `${wsA}/${project2}/${id}/a.exe`;
    await rejects(insertAsset(carol, { id, path, mime: "application/x-msdownload" }), /not supported/);
    await rejects(insertAsset(carol, { id, path: `${wsA}/${project2}/${id}/a.mp4`, size: 0 }), /empty/);
    await rejects(insertAsset(carol, { id, path: `${wsA}/${project2}/${id}/a.mp4`, size: 6e9 }), /upload limit/);
  });

  await test("kind is derived from the MIME type, not the client", async () => {
    const id = randomUUID();
    await insertAsset(carol, { id, kind: "image", path: `${wsA}/${project2}/${id}/a.mp4` });
    assert.equal((await assetRow(id)).kind, "video");
  });

  await test("other agencies and clients cannot create assets in this workspace", async () => {
    const id = randomUUID();
    await rejects(insertAsset(bob, { id, path: `${wsA}/${project2}/${id}/a.mp4` }), /row-level security/);
    await rejects(insertAsset(dana, { id, path: `${wsA}/${project2}/${id}/a.mp4` }), /row-level security/);
  });

  console.log("\nPhase 3 · Storage uploads");
  let upId, upPath;
  await test("only the uploader can write the in-progress file and its thumbnail", async () => {
    upId = randomUUID();
    upPath = `${wsA}/${project2}/${upId}/brief.mp4`;
    await insertAsset(carol, { id: upId, path: upPath, size: 5000 });
    await rejects(putObject(erin, upPath), /row-level security/);
    await rejects(putObject(bob, upPath), /row-level security/);
    await rejects(putObject(carol, `${wsA}/${project2}/${upId}/other.mp4`), /row-level security/);
    await putObject(carol, upPath, { size: 5000, mimetype: "video/mp4" });
    await putObject(carol, `${wsA}/${project2}/${upId}/thumbnail.jpg`, { size: 10, mimetype: "image/jpeg" });
  });

  await test("finalize verifies the stored object; only the uploader (or a manager) may finalize", async () => {
    const missing = randomUUID();
    await insertAsset(carol, { id: missing, path: `${wsA}/${project2}/${missing}/m.mp4` });
    await rejects(finalize(carol, missing), /not found in storage/);

    const wrongSize = randomUUID();
    await insertAsset(carol, { id: wrongSize, path: `${wsA}/${project2}/${wrongSize}/w.mp4`, size: 999 });
    await putObject(carol, `${wsA}/${project2}/${wrongSize}/w.mp4`, { size: 998, mimetype: "video/mp4" });
    await rejects(finalize(carol, wrongSize), /does not match the expected size/);

    const wrongType = randomUUID();
    await insertAsset(carol, { id: wrongType, path: `${wsA}/${project2}/${wrongType}/t.mp4` });
    await putObject(carol, `${wsA}/${project2}/${wrongType}/t.mp4`, { size: 100, mimetype: "video/webm" });
    await rejects(finalize(carol, wrongType), /type does not match/);

    await rejects(finalize(erin, upId), /Asset not found/);
    await rejects(finalize(bob, upId), /Asset not found/);
    const r = await finalize(carol, upId, 42.5, 1920, 1080, 25);
    assert.equal(r.status, "ready");
    const row = await assetRow(upId);
    assert.deepEqual(
      [row.status, Number(row.duration_seconds), row.width, row.height, Number(row.frame_rate), row.thumbnail_path],
      ["ready", 42.5, 1920, 1080, 25, `${wsA}/${project2}/${upId}/thumbnail.jpg`],
    );
    assert.equal((await finalize(carol, upId)).already, true);
  });

  await test("finalize ignores metadata that does not apply to the file kind", async () => {
    const { id } = await uploadAsset(carol, wsA, project2, {
      file: "spec.pdf",
      mime: "application/pdf",
      duration: 9,
      width: 10,
      height: 10,
      fps: 30,
    });
    const row = await assetRow(id);
    assert.deepEqual([row.duration_seconds, row.width, row.height, row.frame_rate], [null, null, null, null]);
  });

  await test("completed files cannot be overwritten", async () => {
    await rejects(putObject(carol, upPath), /row-level security/);
    const res = await as(carol, (tx) =>
      tx.query(`update storage.objects set metadata = '{"size": 1}' where name = $1`, [upPath]),
    );
    assert.equal(res.affectedRows, 0);
  });

  await test("other agencies cannot read or delete the files", async () => {
    const seen = await as(
      bob,
      async (tx) => (await tx.query(`select name from storage.objects where name like $1`, [`${wsA}/%`])).rows,
    );
    const del = await as(bob, (tx) => tx.query(`delete from storage.objects where name = $1`, [upPath]));
    assert.equal(seen.length + del.affectedRows, 0);
  });

  console.log("\nPhase 3 · Asset lifecycle");
  await test("status transitions are enforced and failed uploads can be retried on the same record", async () => {
    await rejects(
      as(carol, (tx) => tx.query(`update public.assets set status = 'uploading' where id = $1`, [upId])),
      /Invalid asset status change/,
    );
    const id = randomUUID();
    await insertAsset(carol, { id, path: `${wsA}/${project2}/${id}/r.mp4` });
    await as(carol, (tx) =>
      tx.query(`update public.assets set status = 'failed', upload_error = 'network' where id = $1`, [id]),
    );
    await as(carol, (tx) => tx.query(`update public.assets set status = 'uploading' where id = $1`, [id]));
    assert.equal((await assetRow(id)).status, "uploading");
  });

  await test("file, type, project and metadata are immutable once uploaded", async () => {
    for (const set of [
      `storage_path = storage_path || 'x'`,
      `mime_type = 'video/webm'`,
      `size_bytes = 1`,
      `version_number = 9`,
      `project_id = '${projectId}'`,
    ]) {
      await rejects(
        as(carol, (tx) => tx.query(`update public.assets set ${set} where id = $1`, [upId])),
        /cannot be changed|violates/,
      );
    }
    await rejects(
      as(carol, (tx) => tx.query(`update public.assets set duration_seconds = 1 where id = $1`, [upId])),
      /metadata cannot be changed/,
    );
    await rejects(
      as(carol, (tx) => tx.query(`update public.assets set thumbnail_path = 'x/y' where id = $1`, [upId])),
      /Invalid thumbnail path/,
    );
    await as(carol, (tx) => tx.query(`update public.assets set name = 'Brief v1' where id = $1`, [upId]));
  });

  await test("clients can read the thumbnail only once the asset is shared", async () => {
    const thumb = `${wsA}/${projectId}/${assetId}/thumbnail.jpg`;
    // The Phase 1 asset in the client-visible project had no thumbnail; there is nothing to read.
    const before = await as(
      dana,
      async (tx) => (await tx.query(`select name from storage.objects where name = $1`, [thumb])).rows,
    );
    assert.equal(before.length, 0);
    const shared = await uploadAsset(carol, wsA, projectId, { file: "share.mp4", thumbnail: true });
    const tName = `${wsA}/${projectId}/${shared.id}/thumbnail.jpg`;
    const hidden = await as(
      dana,
      async (tx) =>
        (await tx.query(`select name from storage.objects where name = any($1)`, [[tName, shared.path]])).rows,
    );
    assert.equal(hidden.length, 0);
    await as(carol, (tx) => tx.query(`update public.assets set shared_with_client = true where id = $1`, [shared.id]));
    const visible = await as(
      dana,
      async (tx) =>
        (await tx.query(`select name from storage.objects where name = any($1) order by name`, [[tName, shared.path]]))
          .rows,
    );
    assert.equal(visible.length, 2);
  });

  console.log("\nPhase 3 · Versions");
  let v2, v3;
  await test("versions are numbered sequentially per original", async () => {
    v2 = (await uploadAsset(carol, wsA, project2, { file: "brief-v2.mp4", root: upId })).id;
    v3 = (await uploadAsset(erin, wsA, project2, { file: "brief-v3.mp4", root: upId })).id;
    assert.deepEqual([(await assetRow(v2)).version_number, (await assetRow(v3)).version_number], [2, 3]);
  });

  await test("a version must target an original in the same project, of the same kind", async () => {
    const id = randomUUID();
    await rejects(
      insertAsset(carol, { id, root: v2, path: `${wsA}/${project2}/${id}/a.mp4` }),
      /added to the original/,
    );
    await rejects(insertAsset(carol, { id, root: assetId, path: `${wsA}/${project2}/${id}/a.mp4` }), /same project/);
    await rejects(
      insertAsset(carol, { id, root: upId, mime: "image/png", path: `${wsA}/${project2}/${id}/a.png` }),
      /same kind/,
    );
    await rejects(
      insertAsset(carol, { id, root: randomUUID(), path: `${wsA}/${project2}/${id}/a.mp4` }),
      /added to the original/,
    );
  });

  await test("version numbers stay unique even if a number is supplied by the caller", async () => {
    const id = randomUUID();
    await as(carol, (tx) =>
      tx.query(
        `insert into public.assets (id, workspace_id, project_id, name, kind, storage_path, mime_type, size_bytes, uploaded_by, root_asset_id, version_number)
         values ($1, $2, $3, 'x', 'video', $4, 'video/mp4', 10, $5, $6, 2)`,
        [id, wsA, project2, `${wsA}/${project2}/${id}/a.mp4`, carol, upId],
      ),
    );
    assert.equal((await assetRow(id)).version_number, 4);
    await as(carol, (tx) => tx.query(`delete from public.assets where id = $1`, [id]));
  });

  console.log("\nPhase 3 · Review comments");
  let c1;
  const addComment = (uid, fields) =>
    as(
      uid,
      async (tx) =>
        (
          await tx.query(
            `insert into public.review_comments (workspace_id, asset_id, author_id, body, timestamp_seconds, annotation, parent_id, is_internal)
         values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, false)) returning *`,
            [
              wsA,
              fields.asset ?? upId,
              uid,
              fields.body ?? "Note",
              fields.t ?? null,
              fields.pin ?? null,
              fields.parent ?? null,
              fields.internal ?? null,
            ],
          )
        ).rows[0],
    );

  await test("comments need an uploaded file", async () => {
    const id = randomUUID();
    await insertAsset(carol, { id, path: `${wsA}/${project2}/${id}/p.mp4` });
    await rejects(addComment(carol, { asset: id }), /uploaded file/);
  });

  await test("timestamps and pins are validated against the media", async () => {
    c1 = await addComment(carol, { t: 12.25, pin: { x: 0.5, y: 0.25 }, body: "Logo too small" });
    assert.deepEqual([Number(c1.timestamp_seconds), c1.annotation], [12.25, { x: 0.5, y: 0.25 }]);
    await rejects(addComment(carol, { t: 60 }), /past the end/);
    await rejects(addComment(carol, { pin: { x: 1.5, y: 0 } }), /annotation_valid/);
    await rejects(addComment(carol, { pin: { x: 0.1, y: 0.1, z: 1 } }), /annotation_valid/);
    await rejects(addComment(carol, { pin: { x: "0.1", y: 0.1 } }), /annotation_valid/);
    const pdf = await uploadAsset(carol, wsA, project2, { file: "deck.pdf", mime: "application/pdf" });
    await rejects(addComment(carol, { asset: pdf.id, t: 1 }), /only available on video and audio/);
    await rejects(addComment(carol, { asset: pdf.id, pin: { x: 0.1, y: 0.1 } }), /only available on video and images/);
    await rejects(addComment(carol, { body: "x".repeat(5001) }), /review_comments_body_check/);
  });

  await test("replies stay on the same file, one level deep, inheriting visibility", async () => {
    const reply = await addComment(erin, { parent: c1.id, t: 3, pin: { x: 0.1, y: 0.1 }, body: "Agreed" });
    assert.deepEqual([reply.timestamp_seconds, reply.annotation], [null, null]);
    await rejects(addComment(erin, { parent: reply.id }), /one level deep/);
    await rejects(addComment(erin, { parent: c1.id, asset: v2 }), /same file/);
    const internal = await addComment(carol, { internal: true, body: "Internal thread" });
    const r2 = await addComment(erin, { parent: internal.id, internal: false, body: "reply" });
    assert.equal(r2.is_internal, true);
  });

  await test("only the author can edit comment text; position and visibility are fixed", async () => {
    await rejects(
      as(erin, (tx) => tx.query(`update public.review_comments set body = 'hijack' where id = $1`, [c1.id])),
      /Only the author/,
    );
    await as(carol, (tx) =>
      tx.query(`update public.review_comments set body = 'Logo too small (edited)' where id = $1`, [c1.id]),
    );
    await rejects(
      as(carol, (tx) => tx.query(`update public.review_comments set is_internal = true where id = $1`, [c1.id])),
      /Only the comment text/,
    );
    await rejects(
      as(carol, (tx) => tx.query(`update public.review_comments set timestamp_seconds = 1 where id = $1`, [c1.id])),
      /Only the comment text/,
    );
    const other = await as(bob, (tx) =>
      tx.query(`update public.review_comments set body = 'x' where id = $1`, [c1.id]),
    );
    assert.equal(other.affectedRows, 0);
  });

  await test("staff resolve top-level comments; the resolver is recorded by the database", async () => {
    const row = await as(
      erin,
      async (tx) =>
        (
          await tx.query(
            `update public.review_comments set resolved_at = now(), resolved_by = $2 where id = $1 returning resolved_by`,
            [c1.id, alice],
          )
        ).rows[0],
    );
    assert.equal(row.resolved_by, erin);
    const reply = (await db.query(`select id from public.review_comments where parent_id = $1 limit 1`, [c1.id]))
      .rows[0];
    await rejects(
      as(erin, (tx) => tx.query(`update public.review_comments set resolved_at = now() where id = $1`, [reply.id])),
      /Replies cannot be resolved/,
    );
    const reopened = await as(
      carol,
      async (tx) =>
        (
          await tx.query(`update public.review_comments set resolved_at = null where id = $1 returning resolved_by`, [
            c1.id,
          ])
        ).rows[0],
    );
    assert.equal(reopened.resolved_by, null);
  });

  await test("clients cannot resolve and never see internal replies", async () => {
    const shared = await uploadAsset(carol, wsA, projectId, { file: "client-cut.mp4", duration: 20 });
    await as(carol, (tx) => tx.query(`update public.assets set shared_with_client = true where id = $1`, [shared.id]));
    const pub = await addComment(carol, { asset: shared.id, t: 2, body: "Public note" });
    await addComment(carol, { asset: shared.id, parent: pub.id, internal: true, body: "Internal reply" });
    const clientComment = await addComment(dana, { asset: shared.id, t: 5, body: "Client note" });
    const seen = await as(
      dana,
      async (tx) =>
        (await tx.query(`select body from public.review_comments where asset_id = $1 order by created_at`, [shared.id]))
          .rows,
    );
    assert.deepEqual(seen.map((r) => r.body).sort(), ["Client note", "Public note"]);
    await rejects(
      as(dana, (tx) =>
        tx.query(`update public.review_comments set resolved_at = now() where id = $1`, [clientComment.id]),
      ),
      /Only the team can resolve/,
    );
  });

  await test("edited_at is set by the database only when the text changes", async () => {
    const fresh = await addComment(carol, { body: "Draft" });
    assert.equal(fresh.edited_at, null);
    const resolved = await as(
      carol,
      async (tx) =>
        (
          await tx.query(`update public.review_comments set resolved_at = now() where id = $1 returning edited_at`, [
            fresh.id,
          ])
        ).rows[0],
    );
    assert.equal(resolved.edited_at, null);
    const edited = await as(
      carol,
      async (tx) =>
        (
          await tx.query(
            `update public.review_comments set body = 'Final', edited_at = null where id = $1 returning edited_at`,
            [fresh.id],
          )
        ).rows[0],
    );
    assert.ok(edited.edited_at);
    const spoof = await as(
      carol,
      async (tx) =>
        (
          await tx.query(`update public.review_comments set edited_at = null where id = $1 returning edited_at`, [
            fresh.id,
          ])
        ).rows[0],
    );
    assert.ok(spoof.edited_at, "edited_at cannot be cleared by the client");
  });

  await test("only the author or a manager can delete a comment; replies go with their thread", async () => {
    const own = await addComment(erin, { body: "Erin's note" });
    const reply = await addComment(carol, { parent: own.id, body: "Reply" });
    const byOther = await as(erin, (tx) => tx.query(`delete from public.review_comments where id = $1`, [c1.id]));
    assert.equal(byOther.affectedRows, 0);
    const outsider = await as(bob, (tx) => tx.query(`delete from public.review_comments where id = $1`, [own.id]));
    assert.equal(outsider.affectedRows, 0);
    const byManager = await as(alice, (tx) => tx.query(`delete from public.review_comments where id = $1`, [own.id]));
    assert.equal(byManager.affectedRows, 1);
    const left = await db.query(`select id from public.review_comments where id = $1`, [reply.id]);
    assert.equal(left.rows.length, 0);
    const mine = await addComment(erin, { body: "Mine" });
    const self = await as(erin, (tx) => tx.query(`delete from public.review_comments where id = $1`, [mine.id]));
    assert.equal(self.affectedRows, 1);
  });

  console.log("\nPhase 3 · Activity & summary");
  await test("uploads, versions, comments and resolutions are logged", async () => {
    const acts = (
      await db.query(`select action, entity_id, metadata from public.activity_log where workspace_id = $1`, [wsA])
    ).rows;
    const has = (action, pred = () => true) => acts.some((a) => a.action === action && pred(a));
    assert.ok(has("asset.uploaded", (a) => a.entity_id === upId && a.metadata.project_id === project2));
    assert.ok(has("asset.version_added", (a) => a.entity_id === upId && a.metadata.version === 3));
    assert.ok(has("comment.created", (a) => a.metadata.root_asset_id === upId));
    assert.ok(has("comment.resolved"));
  });

  await test("review summary shows the latest version and open comments, scoped by RLS", async () => {
    const mine = await as(
      carol,
      async (tx) =>
        (await tx.query(`select * from public.asset_review_summary where root_asset_id = $1`, [upId])).rows[0],
    );
    assert.deepEqual([mine.latest_asset_id, mine.latest_version_number, mine.version_count], [v3, 3, 3]);
    await addComment(carol, { asset: v3, t: 1, body: "On v3" });
    const after = await as(
      carol,
      async (tx) =>
        (await tx.query(`select open_comment_count from public.asset_review_summary where root_asset_id = $1`, [upId]))
          .rows[0],
    );
    assert.equal(after.open_comment_count, 1);
    const outsider = await as(
      bob,
      async (tx) => (await tx.query(`select * from public.asset_review_summary where workspace_id = $1`, [wsA])).rows,
    );
    assert.equal(outsider.length, 0);
    const client = await as(dana, async (tx) => (await tx.query(`select name from public.asset_review_summary`)).rows);
    assert.ok(client.length > 0 && client.every((r) => ["share.mp4", "client-cut.mp4", "cut-v1.mp4"].includes(r.name)));
    const anonRows = await as(null, (tx) => tx.query(`select * from public.asset_review_summary`)).catch((e) => e);
    assert.match(String(anonRows.message ?? anonRows), /permission denied/);
  });

  await test("upload constraints expose the bucket limit and allowed types", async () => {
    const c = await as(erin, async (tx) => (await tx.query(`select public.asset_upload_constraints() as c`)).rows[0].c);
    assert.equal(Number(c.file_size_limit), 5368709120);
    assert.ok(c.allowed_mime_types.includes("video/mp4") && !c.allowed_mime_types.includes("application/zip"));
  });

  await test("deleting an original removes its versions and logs a single deletion", async () => {
    const before = (await db.query(`select count(*)::int n from public.activity_log where action = 'asset.deleted'`))
      .rows[0].n;
    await as(carol, (tx) => tx.query(`delete from public.assets where id = $1`, [upId]));
    const left = (await db.query(`select count(*)::int n from public.assets where id = any($1)`, [[upId, v2, v3]]))
      .rows[0].n;
    const after = (await db.query(`select count(*)::int n from public.activity_log where action = 'asset.deleted'`))
      .rows[0].n;
    assert.deepEqual([left, after - before], [0, 1]);
  });

  await test("members cannot delete other people's assets", async () => {
    const { id } = await uploadAsset(carol, wsA, project2, { file: "keep.mp4" });
    const res = await as(erin, (tx) => tx.query(`delete from public.assets where id = $1`, [id]));
    assert.equal(res.affectedRows, 0);
  });

  /* ======================================================================== */
  /* Phase 4: client portal & approvals                                       */
  /* ======================================================================== */

  const gina = await createUser("gina@portal.test", "Gina");
  const helen = await createUser("helen@portal.test", "Helen");
  async function clientInvite(inviter, ws, email, cid) {
    const t = newToken();
    await as(inviter, (tx) =>
      tx.query(
        `insert into public.workspace_invitations (workspace_id, email, role, client_id, token_hash, invited_by)
         values ($1, $2, 'client', $3, $4, $5)`,
        [ws, email, cid, hashToken(t), inviter],
      ),
    );
    return t;
  }
  const projectStatus = async (id) =>
    (await db.query(`select status from public.projects where id = $1`, [id])).rows[0].status;
  const requestApproval = (uid, asset, title = "Cut for sign-off", message = null, due = null) =>
    as(
      uid,
      async (tx) =>
        (await tx.query(`select public.request_approval($1, $2, $3, $4) as id`, [asset, title, message, due])).rows[0]
          .id,
    );
  const decide = (uid, approval, decision, note = null) =>
    as(uid, (tx) => tx.query(`select public.decide_approval($1, $2, $3)`, [approval, decision, note]));

  console.log("\nPhase 4 · Client portal access (D2)");
  let portalClient, pP, pHidden;
  await test("managers invite client users; team invitations stay admin-only", async () => {
    portalClient = await as(
      carol,
      async (tx) =>
        (
          await tx.query(
            `insert into public.clients (workspace_id, name, company, notes, created_by)
             values ($1, 'Pat', 'Portal Co', 'Agency-only: slow payer', $2) returning id`,
            [wsA, carol],
          )
        ).rows[0].id,
    );
    const t = await clientInvite(carol, wsA, "gina@portal.test", portalClient);
    await as(gina, (tx) => tx.query(`select public.accept_invitation($1)`, [t]));
    const t2 = await clientInvite(carol, wsA, "helen@portal.test", portalClient);
    await as(helen, (tx) => tx.query(`select public.accept_invitation($1)`, [t2]));
    const { rows } = await db.query(
      `select role, client_id from public.workspace_members where workspace_id = $1 and user_id in ($2, $3)`,
      [wsA, gina, helen],
    );
    assert.deepEqual(
      rows.map((r) => [r.role, r.client_id]),
      [
        ["client", portalClient],
        ["client", portalClient],
      ],
    );
    await rejects(
      as(carol, (tx) =>
        tx.query(
          `insert into public.workspace_invitations (workspace_id, email, role, token_hash, invited_by)
           values ($1, 'x@agency-a.test', 'member', $2, $3)`,
          [wsA, hashToken(newToken()), carol],
        ),
      ),
      /row-level security/,
    );
    await rejects(clientInvite(erin, wsA, "y@portal.test", portalClient), /row-level security/);
    await rejects(
      as(carol, (tx) =>
        tx.query(
          `insert into public.workspace_invitations (workspace_id, email, role, client_id, token_hash, invited_by)
           values ($1, 'z@portal.test', 'client', $2, $3, $4)`,
          [wsA, portalClient, hashToken(newToken()), alice],
        ),
      ),
      /row-level security/,
    );
  });

  await test("managers see and revoke client invitations only", async () => {
    await clientInvite(carol, wsA, "pending@portal.test", portalClient);
    await as(alice, (tx) =>
      tx.query(
        `insert into public.workspace_invitations (workspace_id, email, role, token_hash, invited_by)
         values ($1, 'teammate@agency-a.test', 'member', $2, $3)`,
        [wsA, hashToken(newToken()), alice],
      ),
    );
    const seen = await as(
      carol,
      async (tx) => (await tx.query(`select role from public.workspace_invitations where accepted_at is null`)).rows,
    );
    assert.ok(seen.length > 0 && seen.every((r) => r.role === "client"));
    const teamDel = await as(carol, (tx) =>
      tx.query(`delete from public.workspace_invitations where email = 'teammate@agency-a.test'`),
    );
    assert.equal(teamDel.affectedRows, 0);
    const del = await as(carol, (tx) =>
      tx.query(`delete from public.workspace_invitations where email = 'pending@portal.test'`),
    );
    assert.equal(del.affectedRows, 1);
    const memberSees = await as(
      erin,
      async (tx) => (await tx.query(`select id from public.workspace_invitations`)).rows,
    );
    assert.equal(memberSees.length, 0);
    await as(alice, (tx) =>
      tx.query(`delete from public.workspace_invitations where email = 'teammate@agency-a.test'`),
    );
  });

  await test("managers remove client users but not staff; members cannot remove anyone", async () => {
    const staff = await as(carol, (tx) =>
      tx.query(`delete from public.workspace_members where workspace_id = $1 and user_id = $2`, [wsA, erin]),
    );
    assert.equal(staff.affectedRows, 0);
    const byMember = await as(erin, (tx) =>
      tx.query(`delete from public.workspace_members where workspace_id = $1 and user_id = $2`, [wsA, helen]),
    );
    assert.equal(byMember.affectedRows, 0);
    const outsider = await as(bob, (tx) =>
      tx.query(`delete from public.workspace_members where workspace_id = $1 and user_id = $2`, [wsA, helen]),
    );
    assert.equal(outsider.affectedRows, 0);
  });

  console.log("\nPhase 4 · Portal reads (G1)");
  await test("portal_projects returns safe fields for the client's visible projects only", async () => {
    pP = await as(
      carol,
      async (tx) =>
        (
          await tx.query(
            `insert into public.projects (workspace_id, client_id, name, description, budget_cents, client_visible,
                                          client_summary, start_date, due_date, created_by)
             values ($1, $2, 'Portal film', 'Internal brief: margin is thin', 990000, true,
                     'Your 30-second launch film', '2026-10-01', '2026-12-01', $3) returning id`,
            [wsA, portalClient, carol],
          )
        ).rows[0].id,
    );
    pHidden = await as(
      carol,
      async (tx) =>
        (
          await tx.query(
            `insert into public.projects (workspace_id, client_id, name, created_by)
             values ($1, $2, 'Not shared yet', $3) returning id`,
            [wsA, portalClient, carol],
          )
        ).rows[0].id,
    );
    const rows = await as(gina, async (tx) => (await tx.query(`select * from public.portal_projects($1)`, [wsA])).rows);
    assert.deepEqual(
      rows.map((r) => r.id),
      [pP],
    );
    const r = rows[0];
    assert.deepEqual(Object.keys(r).sort(), [
      "allow_client_downloads",
      "client_name",
      "client_summary",
      "due_date",
      "id",
      "name",
      "pending_approvals",
      "shared_files",
      "start_date",
      "status",
      "updated_at",
    ]);
    assert.equal(r.client_name, "Portal Co");
    assert.equal(r.client_summary, "Your 30-second launch film");
    assert.equal(r.allow_client_downloads, true);
    assert.equal(r.pending_approvals, 0);
    assert.equal(r.shared_files, 0);
  });

  await test("portal_project returns one visible project; nothing for other clients, staff or outsiders", async () => {
    const one = await as(gina, async (tx) => (await tx.query(`select * from public.portal_project($1)`, [pP])).rows);
    assert.equal(one.length, 1);
    assert.equal(one[0].workspace_id, wsA);
    assert.ok(!("budget_cents" in one[0]) && !("description" in one[0]));
    for (const [uid, project] of [
      [gina, pHidden],
      [dana, pP],
      [alice, pP],
      [bob, pP],
    ]) {
      const rows = await as(
        uid,
        async (tx) => (await tx.query(`select id from public.portal_project($1)`, [project])).rows,
      );
      assert.equal(rows.length, 0);
    }
    const danaList = await as(
      dana,
      async (tx) => (await tx.query(`select id from public.portal_projects($1)`, [wsA])).rows,
    );
    assert.ok(!danaList.some((r) => r.id === pP));
    const outsider = await as(
      bob,
      async (tx) => (await tx.query(`select id from public.portal_projects($1)`, [wsA])).rows,
    );
    assert.equal(outsider.length, 0);
    await rejects(
      as(null, (tx) => tx.query(`select * from public.portal_projects($1)`, [wsA])),
      /permission denied/,
    );
  });

  await test("clients cannot read budgets, briefs or the agency's client notes directly", async () => {
    const projects = await as(
      gina,
      async (tx) => (await tx.query(`select budget_cents, description from public.projects`)).rows,
    );
    assert.equal(projects.length, 0);
    const clients = await as(gina, async (tx) => (await tx.query(`select notes from public.clients`)).rows);
    assert.equal(clients.length, 0);
    const staff = await as(
      erin,
      async (tx) => (await tx.query(`select notes from public.clients where id = $1`, [portalClient])).rows,
    );
    assert.equal(staff[0].notes, "Agency-only: slow payer");
  });

  await test("client_summary is limited and allow_client_downloads defaults to true", async () => {
    await rejects(
      as(carol, (tx) =>
        tx.query(`update public.projects set client_summary = $1 where id = $2`, ["x".repeat(2001), pP]),
      ),
      /check constraint/,
    );
    const { rows } = await db.query(`select allow_client_downloads from public.projects where id = $1`, [pHidden]);
    assert.equal(rows[0].allow_client_downloads, true);
  });

  console.log("\nPhase 4 · Approval requests (G2, G3, D4, D5)");
  let fileA, fileB, apA;
  await test("an approval needs a ready, shared version of a portal-visible project", async () => {
    ({ id: fileA } = await uploadAsset(carol, wsA, pP, { file: "portal-v1.mp4", duration: 20 }));
    const { id: unready } = await uploadAsset(carol, wsA, pP, { file: "pending.mp4", finalize: false });
    const { id: otherProjectFile } = await uploadAsset(carol, wsA, projectId, { file: "other.mp4", duration: 5 });
    const { id: hiddenFile } = await uploadAsset(carol, wsA, pHidden, { file: "hidden.mp4", duration: 5 });
    const insert = (asset, project = pP, extra = "") =>
      as(erin, (tx) =>
        tx.query(
          `insert into public.approvals (workspace_id, project_id, asset_id, title, requested_by${extra ? ", status" : ""})
           values ($1, $2, $3, 'Sign-off', $4${extra ? ", " + extra : ""})`,
          [wsA, project, asset, erin],
        ),
      );
    await rejects(insert(fileA), /Share this version with the client/);
    await rejects(insert(null), /Choose the version/);
    await rejects(insert(otherProjectFile), /must belong to this project/);
    await rejects(insert(unready), /Only uploaded files/);
    await as(carol, (tx) => tx.query(`update public.assets set shared_with_client = true where id = $1`, [hiddenFile]));
    await rejects(insert(hiddenFile, pHidden), /Show the project in the client portal/);
    await rejects(requestApproval(erin, unready), /Only uploaded files/);
  });

  await test("request_approval shares the version, moves the project into review and notifies the client's users", async () => {
    assert.equal(await projectStatus(pP), "planning");
    apA = await requestApproval(erin, fileA, "  Launch cut v1  ", "Please review by Friday", "2099-01-01");
    const { rows } = await db.query(
      `select a.shared_with_client, ap.title, ap.message, ap.status, ap.requested_by
       from public.approvals ap join public.assets a on a.id = ap.asset_id where ap.id = $1`,
      [apA],
    );
    assert.equal(rows[0].shared_with_client, true);
    assert.equal(rows[0].title, "Launch cut v1");
    assert.equal(rows[0].status, "pending");
    assert.equal(rows[0].requested_by, erin);
    assert.equal(await projectStatus(pP), "in_review");
    for (const uid of [gina, helen]) {
      const notes = await as(
        uid,
        async (tx) => (await tx.query(`select type, title, body, link, actor_id from public.notifications`)).rows,
      );
      assert.deepEqual(notes, [
        {
          type: "approval.requested",
          title: "Approval requested: Launch cut v1",
          body: "Please review by Friday",
          link: `/portal/projects/${pP}/files/${fileA}`,
          actor_id: erin,
        },
      ]);
    }
    const danaNotes = await as(
      dana,
      async (tx) =>
        (await tx.query(`select id from public.notifications where link like $1`, [`/portal/projects/${pP}/%`])).rows,
    );
    assert.equal(danaNotes.length, 0);
    const logs = await activity(wsA, "approval.requested");
    assert.equal(logs.at(-1).actor_id, erin);
    assert.deepEqual(logs.at(-1).metadata, { title: "Launch cut v1", project_id: pP, asset_id: fileA });
    const portal = await as(
      gina,
      async (tx) => (await tx.query(`select * from public.portal_projects($1)`, [wsA])).rows,
    );
    assert.equal(portal[0].pending_approvals, 1);
    assert.equal(portal[0].shared_files, 1);
    assert.equal(portal[0].status, "in_review");
  });

  await test("request_approval validates input and access", async () => {
    await rejects(requestApproval(erin, fileA, "   "), /Give the approval a title/);
    await rejects(requestApproval(erin, fileA, "Late", null, "2000-01-01"), /can't be in the past/);
    await rejects(requestApproval(gina, fileA), /File not found/);
    await rejects(requestApproval(bob, fileA), /File not found/);
    await rejects(
      as(null, (tx) => tx.query(`select public.request_approval($1, 'x')`, [fileA])),
      /permission denied/,
    );
  });

  await test("only one pending approval per version", async () => {
    await rejects(requestApproval(carol, fileA, "Again"), /already has a pending approval/);
    await rejects(
      as(carol, (tx) =>
        tx.query(
          `insert into public.approvals (workspace_id, project_id, asset_id, title, requested_by) values ($1, $2, $3, 'Dup', $4)`,
          [wsA, pP, fileA, carol],
        ),
      ),
      /approvals_one_pending_per_asset/,
    );
  });

  await test("a version or project under approval cannot be hidden from the client", async () => {
    await rejects(
      as(carol, (tx) => tx.query(`update public.assets set shared_with_client = false where id = $1`, [fileA])),
      /Cancel the pending approval/,
    );
    for (const set of ["client_visible = false", "archived_at = now()", "client_id = null"]) {
      await rejects(
        as(carol, (tx) => tx.query(`update public.projects set ${set} where id = $1`, [pP])),
        /Cancel the pending approvals/,
      );
    }
    await rejects(
      as(carol, (tx) => tx.query(`delete from public.clients where id = $1`, [portalClient])),
      /Cancel the pending approvals/,
    );
    await as(carol, (tx) => tx.query(`update public.projects set name = 'Portal film (final)' where id = $1`, [pP]));
  });

  await test("approvals cannot be decided, re-targeted or forged by direct updates", async () => {
    await rejects(
      as(carol, (tx) => tx.query(`update public.approvals set status = 'approved' where id = $1`, [apA])),
      /decided through the approval workflow/,
    );
    await rejects(
      as(carol, (tx) => tx.query(`update public.approvals set decision_note = 'ok' where id = $1`, [apA])),
      /recorded by the approval workflow/,
    );
    await rejects(
      as(carol, (tx) => tx.query(`update public.approvals set decided_by = $2 where id = $1`, [apA, gina])),
      /recorded by the approval workflow/,
    );
    ({ id: fileB } = await uploadAsset(carol, wsA, pP, { file: "portal-alt.mp4", duration: 20 }));
    await rejects(
      as(carol, (tx) => tx.query(`update public.approvals set asset_id = $2 where id = $1`, [apA, fileB])),
      /cannot be changed/,
    );
    // The old session flag grants nothing here: only decide_approval() decides.
    await rejects(
      as(carol, async (tx) => {
        await tx.query(`select set_config('creativeflow.trusted_rpc', 'on', true)`);
        await tx.query(`update public.approvals set status = 'approved' where id = $1`, [apA]);
      }),
      /decided through the approval workflow/,
    );
    const flag = await as(gina, async (tx) => (await tx.query(`select private.in_approval_workflow() as f`)).rows[0].f);
    assert.equal(flag, false);
    await rejects(
      as(carol, (tx) =>
        tx.query(
          `insert into public.approvals (workspace_id, project_id, asset_id, title, requested_by, status) values ($1, $2, $3, 'x', $4, 'approved')`,
          [wsA, pP, fileB, carol],
        ),
      ),
      /row-level security|must be pending/,
    );
    const rows = await as(
      gina,
      async (tx) =>
        (await tx.query(`update public.approvals set title = 'hacked' where id = $1 returning id`, [apA])).rows,
    );
    assert.equal(rows.length, 0);
  });

  await test("clients see approvals only for versions they can see", async () => {
    const seen = await as(gina, async (tx) => (await tx.query(`select id from public.approvals`)).rows);
    assert.deepEqual(
      seen.map((r) => r.id),
      [apA],
    );
    const other = await as(
      dana,
      async (tx) => (await tx.query(`select id from public.approvals where id = $1`, [apA])).rows,
    );
    assert.equal(other.length, 0);
    const outsider = await as(bob, async (tx) => (await tx.query(`select id from public.approvals`)).rows);
    assert.equal(outsider.length, 0);
  });

  console.log("\nPhase 4 · Decisions & revision rounds (G2, G4, G5)");
  await test("only the bound client (or a manager) may decide; members and other clients may not", async () => {
    await rejects(decide(dana, apA, "approved"), /Approval not found/);
    await rejects(decide(bob, apA, "approved"), /Approval not found/);
    await rejects(decide(erin, apA, "approved"), /Approval not found/);
    await rejects(decide(gina, apA, "changes_requested", "  "), /describe the requested changes/);
    await rejects(decide(gina, apA, "changes_requested", "x".repeat(5001)), /too long/);
    await rejects(decide(gina, apA, "cancelled"), /approved or changes_requested/);
  });

  let round1;
  await test("changes requested opens the next revision round and moves the project to revisions", async () => {
    await decide(gina, apA, "changes_requested", "  Brighter opening shot  ");
    const { rows } = await db.query(
      `select id, round_number, summary, status, asset_id, approval_id, requested_by from public.revisions where project_id = $1`,
      [pP],
    );
    assert.equal(rows.length, 1);
    round1 = rows[0].id;
    assert.equal(rows[0].round_number, 1);
    assert.equal(rows[0].summary, "Brighter opening shot");
    assert.equal(rows[0].status, "open");
    assert.equal(rows[0].asset_id, fileA);
    assert.equal(rows[0].approval_id, apA);
    assert.equal(rows[0].requested_by, gina);
    assert.equal(await projectStatus(pP), "revisions");
    const ap = (
      await db.query(`select status, decided_by, decision_note, decided_at from public.approvals where id = $1`, [apA])
    ).rows[0];
    assert.equal(ap.status, "changes_requested");
    assert.equal(ap.decided_by, gina);
    assert.equal(ap.decision_note, "Brighter opening shot");
    assert.ok(ap.decided_at);
    const notes = await as(
      erin,
      async (tx) =>
        (await tx.query(`select type, link, actor_id from public.notifications where type like 'approval.%'`)).rows,
    );
    assert.deepEqual(notes, [
      { type: "approval.changes_requested", link: `/app/projects/${pP}/assets/${fileA}`, actor_id: gina },
    ]);
    const logs = await activity(wsA, "approval.changes_requested");
    assert.deepEqual(logs.at(-1), {
      actor_id: gina,
      metadata: { title: "Launch cut v1", project_id: pP, asset_id: fileA },
    });
    assert.equal((await activity(wsA, "revision.opened")).at(-1).metadata.round, 1);
    await rejects(decide(gina, apA, "approved"), /already been decided/);
    await rejects(
      as(carol, (tx) => tx.query(`update public.approvals set status = 'cancelled' where id = $1`, [apA])),
      /already been closed/,
    );
  });

  await test("revision round numbers are allocated by the database", async () => {
    const round = await as(
      carol,
      async (tx) =>
        (
          await tx.query(
            `insert into public.revisions (workspace_id, project_id, round_number, summary, requested_by)
             values ($1, $2, 1, 'Internal polish pass', $3) returning round_number`,
            [wsA, pP, carol],
          )
        ).rows[0].round_number,
    );
    assert.equal(round, 2);
    await rejects(
      as(carol, (tx) =>
        tx.query(
          `insert into public.revisions (workspace_id, project_id, approval_id, summary, requested_by) values ($1, $2, $3, 'x', $4)`,
          [wsA, pHidden, apA, carol],
        ),
      ),
      /approval must belong to this project/,
    );
    await rejects(
      as(carol, (tx) =>
        tx.query(
          `insert into public.revisions (workspace_id, project_id, asset_id, summary, requested_by) values ($1, $2, $3, 'x', $4)`,
          [wsA, pHidden, fileA, carol],
        ),
      ),
      /file must belong to this project/,
    );
  });

  await test("only a revision round's status changes; completion is timestamped and logged", async () => {
    await rejects(
      as(carol, (tx) => tx.query(`update public.revisions set round_number = 9 where id = $1`, [round1])),
      /Only a revision round's status/,
    );
    await rejects(
      as(carol, (tx) => tx.query(`update public.revisions set summary = 'rewritten' where id = $1`, [round1])),
      /Only a revision round's status/,
    );
    await as(erin, (tx) => tx.query(`update public.revisions set status = 'in_progress' where id = $1`, [round1]));
    await as(erin, (tx) =>
      tx.query(`update public.revisions set status = 'completed', completed_at = '2000-01-01' where id = $1`, [round1]),
    );
    let r = (await db.query(`select completed_at from public.revisions where id = $1`, [round1])).rows[0];
    assert.ok(r.completed_at && new Date(r.completed_at).getFullYear() > 2000);
    await as(erin, (tx) => tx.query(`update public.revisions set status = 'open' where id = $1`, [round1]));
    r = (await db.query(`select completed_at from public.revisions where id = $1`, [round1])).rows[0];
    assert.equal(r.completed_at, null);
    await as(erin, (tx) => tx.query(`update public.revisions set status = 'completed' where id = $1`, [round1]));
    assert.ok((await activity(wsA, "revision.in_progress")).length >= 1);
    assert.ok((await activity(wsA, "revision.completed")).length >= 1);
    const clientUpd = await as(gina, (tx) =>
      tx.query(`update public.revisions set status = 'open' where id = $1`, [round1]),
    );
    assert.equal(clientUpd.affectedRows, 0);
  });

  let apB, apC;
  await test("approved only marks the project approved when nothing else is outstanding", async () => {
    apB = await requestApproval(erin, fileB, "Alt cut");
    assert.equal(await projectStatus(pP), "in_review");
    const { id: fileC } = await uploadAsset(carol, wsA, pP, { file: "portal-v2.mp4", duration: 20, root: fileA });
    apC = await requestApproval(carol, fileC, "Launch cut v2");
    await decide(gina, apB, "approved");
    assert.equal(await projectStatus(pP), "in_review", "another approval is still pending");
    await rejects(decide(helen, apB, "approved"), /already been decided/);
    const r2 = (await db.query(`select id from public.revisions where project_id = $1 and round_number = 2`, [pP]))
      .rows[0].id;
    await decide(helen, apC, "approved", "Looks great");
    assert.equal(await projectStatus(pP), "in_review", "revision round 2 is still open");
    await as(carol, (tx) => tx.query(`update public.revisions set status = 'completed' where id = $1`, [r2]));
    const apD = await requestApproval(carol, fileA, "Launch cut v1 (again)");
    await decide(gina, apD, "approved");
    assert.equal(await projectStatus(pP), "approved");
    const notes = await as(
      carol,
      async (tx) =>
        (
          await tx.query(
            `select title, body from public.notifications where type = 'approval.approved' order by created_at`,
          )
        ).rows,
    );
    assert.deepEqual(notes, [
      { title: "Approved: Launch cut v2", body: "Looks great" },
      { title: "Approved: Launch cut v1 (again)", body: null },
    ]);
    const logs = (await activity(wsA, "approval.approved")).filter((l) => l.metadata.project_id === pP);
    assert.deepEqual(
      logs.map((l) => l.actor_id),
      [gina, helen, gina],
    );
  });

  await test("decisions never override delivered, cancelled or on-hold projects", async () => {
    const { id: f } = await uploadAsset(carol, wsA, pP, { file: "portal-final.mp4", duration: 20 });
    const ap1 = await requestApproval(carol, f, "Final master");
    await as(carol, (tx) => tx.query(`update public.projects set status = 'on_hold' where id = $1`, [pP]));
    await decide(gina, ap1, "approved");
    assert.equal(await projectStatus(pP), "on_hold");
    await as(carol, (tx) => tx.query(`update public.projects set status = 'delivered' where id = $1`, [pP]));
    const ap2 = await requestApproval(carol, f, "Final master (re-check)");
    assert.equal(await projectStatus(pP), "delivered");
    await decide(gina, ap2, "changes_requested", "One typo in the end card");
    assert.equal(await projectStatus(pP), "delivered");
  });

  await test("cancelling records who cancelled, is logged, and frees the version", async () => {
    const { rows } = await db.query(
      `select id from public.assets where project_id = $1 and name = 'portal-final.mp4'`,
      [pP],
    );
    const f = rows[0].id;
    const ap = await requestApproval(erin, f, "One more look");
    await as(erin, (tx) => tx.query(`update public.approvals set status = 'cancelled' where id = $1`, [ap]));
    const row = (await db.query(`select status, decided_by, decided_at from public.approvals where id = $1`, [ap]))
      .rows[0];
    assert.equal(row.status, "cancelled");
    assert.equal(row.decided_by, erin);
    assert.ok(row.decided_at);
    assert.equal((await activity(wsA, "approval.cancelled")).at(-1).actor_id, erin);
    await rejects(decide(gina, ap, "approved"), /already been decided/);
    await as(carol, (tx) => tx.query(`update public.assets set shared_with_client = false where id = $1`, [f]));
    const gone = await as(
      gina,
      async (tx) => (await tx.query(`select id from public.approvals where id = $1`, [ap])).rows,
    );
    assert.equal(gone.length, 0, "unshared version hides its approvals from the client");
  });

  await test("a client cannot decide on a version that is no longer visible to them", async () => {
    const { id: f } = await uploadAsset(carol, wsA, pP, { file: "portal-last.mp4", duration: 20 });
    const ap = await requestApproval(carol, f, "Last look");
    // Bypass the guard as the table owner to simulate an inconsistent state.
    await db.exec(`alter table public.assets disable trigger assets_guard_pending_approval`);
    await db.query(`update public.assets set shared_with_client = false where id = $1`, [f]);
    await db.exec(`alter table public.assets enable trigger assets_guard_pending_approval`);
    await rejects(decide(gina, ap, "approved"), /Approval not found/);
    await decide(carol, ap, "approved");
  });

  await test("deleting a file or a user keeps approvals and revision rounds consistent", async () => {
    const temp = await createUser("temp@portal.test", "Temp");
    const t = await clientInvite(carol, wsA, "temp@portal.test", portalClient);
    await as(temp, (tx) => tx.query(`select public.accept_invitation($1)`, [t]));
    const { id: f } = await uploadAsset(carol, wsA, pP, { file: "portal-temp.mp4", duration: 20 });
    const ap = await requestApproval(carol, f, "Temp review");
    await decide(temp, ap, "changes_requested", "Temp feedback");
    await db.query(`delete from auth.users where id = $1`, [temp]);
    const row = (await db.query(`select decided_by from public.approvals where id = $1`, [ap])).rows[0];
    assert.equal(row.decided_by, null);
    const rev = (await db.query(`select id, requested_by from public.revisions where approval_id = $1`, [ap])).rows[0];
    assert.equal(rev.requested_by, null);
    await as(carol, (tx) => tx.query(`delete from public.assets where id = $1`, [f]));
    const after = (await db.query(`select approval_id, asset_id from public.revisions where id = $1`, [rev.id]))
      .rows[0];
    assert.deepEqual(after, { approval_id: null, asset_id: null });
    assert.equal((await db.query(`select count(*)::int as n from public.approvals where id = $1`, [ap])).rows[0].n, 0);
  });

  await test("managers can remove a client user's portal access", async () => {
    const del = await as(carol, (tx) =>
      tx.query(`delete from public.workspace_members where workspace_id = $1 and user_id = $2`, [wsA, helen]),
    );
    assert.equal(del.affectedRows, 1);
    const rows = await as(
      helen,
      async (tx) => (await tx.query(`select id from public.portal_projects($1)`, [wsA])).rows,
    );
    assert.equal(rows.length, 0);
    assert.ok((await activity(wsA, "member.removed")).length >= 1);
  });

  console.log("\nPhase 2 · Cleanup");
  await test("deleting a populated workspace removes all of its data", async () => {
    const tmp = await as(
      alice,
      async (tx) => (await tx.query(`select public.create_workspace('Cascade WS', 'cascade-ws') as id`)).rows[0].id,
    );
    await inviteAndAccept(alice, tmp, "erin@agency-a.test", "manager", erin);
    const cid = await as(
      erin,
      async (tx) =>
        (
          await tx.query(
            `insert into public.clients (workspace_id, name, created_by) values ($1, 'C', $2) returning id`,
            [tmp, erin],
          )
        ).rows[0].id,
    );
    const pid = await as(
      erin,
      async (tx) =>
        (
          await tx.query(
            `insert into public.projects (workspace_id, client_id, name, created_by) values ($1, $2, 'P1', $3) returning id`,
            [tmp, cid, erin],
          )
        ).rows[0].id,
    );
    await as(erin, (tx) =>
      tx.query(
        `insert into public.tasks (workspace_id, project_id, title, created_by, assignee_id) values ($1, $2, 'T', $3, $3)`,
        [tmp, pid, erin],
      ),
    );
    await as(erin, (tx) =>
      tx.query(`insert into public.project_members (project_id, workspace_id, user_id) values ($1, $2, $3)`, [
        pid,
        tmp,
        erin,
      ]),
    );
    await as(alice, (tx) => tx.query(`delete from public.workspaces where id = $1`, [tmp]));
    const { rows } = await db.query(
      `select (select count(*) from public.workspace_members where workspace_id = $1)
            + (select count(*) from public.clients where workspace_id = $1)
            + (select count(*) from public.projects where workspace_id = $1)
            + (select count(*) from public.tasks where workspace_id = $1)
            + (select count(*) from public.activity_log where workspace_id = $1) as n`,
      [tmp],
    );
    assert.equal(Number(rows[0].n), 0);
  });

  console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
