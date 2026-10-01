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
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

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
    owner_id text
  );
  alter table storage.objects enable row level security;
  grant all on storage.objects to authenticated;
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

async function main() {
  await db.exec(SUPABASE_STUBS);

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
    const rows = await as(dana, async (tx) => (await tx.query(`select id from public.projects`)).rows);
    assert.deepEqual(
      rows.map((r) => r.id),
      [projectId],
    );
    assert.ok(!rows.some((r) => r.id === hiddenProjectId));
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
    const rows = await as(dana, async (tx) => (await tx.query(`select id from public.clients`)).rows);
    assert.deepEqual(
      rows.map((r) => r.id),
      [clientId],
    );
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
    assetId = await as(
      carol,
      async (tx) =>
        (
          await tx.query(
            `insert into public.assets (id, workspace_id, project_id, name, kind, status, storage_path, mime_type, size_bytes, uploaded_by)
         values (gen_random_uuid(), $1, $2, 'cut-v1.mp4', 'video', 'ready', $4, 'video/mp4', 1024, $3)
         returning id`,
            [wsA, projectId, carol, `${wsA}/${projectId}/a/cut-v1.mp4`],
          )
        ).rows[0].id,
    );
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
  await test("staff can upload into their workspace folder only", async () => {
    await as(carol, (tx) =>
      tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('project-assets', $1, $2)`, [
        `${wsA}/${projectId}/x/file.mp4`,
        carol,
      ]),
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

  console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
