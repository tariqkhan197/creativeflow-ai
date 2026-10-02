#!/usr/bin/env node
/**
 * Verifies a real Supabase project is configured for CreativeFlow AI.
 *
 *   npm run verify:supabase          # configuration, database, auth and storage checks (read-only)
 *   npm run verify:supabase -- --e2e # also sign in two throwaway users, create a workspace,
 *                                    # check tenant isolation, then delete everything it created
 *
 * Reads .env.local. It NEVER prints key values — only whether they look right.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const E2E = process.argv.includes("--e2e");

const results = { pass: 0, warn: 0, fail: 0 };
const ok = (msg) => (results.pass++, console.log(`  ✓ ${msg}`));
const warn = (msg, fix) => (results.warn++, console.log(`  ! ${msg}${fix ? `\n      → ${fix}` : ""}`));
const fail = (msg, fix) => (results.fail++, console.log(`  ✗ ${msg}${fix ? `\n      → ${fix}` : ""}`));
const section = (title) => console.log(`\n${title}`);

/* ------------------------------------------------------------------ env -- */

function loadEnvFile(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    const quoted = value.match(/^(['"])(.*?)\1/);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "");
    env[m[1]] = value.trim();
  }
  return env;
}

/** Describe a key without revealing it. */
function keyKind(key) {
  if (!key) return "missing";
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "secret";
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (payload.role === "anon") return "legacy-anon";
      if (payload.role === "service_role") return "legacy-service-role";
    } catch {
      /* fall through */
    }
  }
  return "unknown";
}

section("Environment (.env.local)");
const envPath = path.join(root, ".env.local");
if (!existsSync(envPath)) {
  fail(".env.local not found", "Run: cp .env.example .env.local — then fill in the Supabase values");
  finish();
}
const env = loadEnvFile(envPath);

try {
  execFileSync("git", ["check-ignore", "-q", ".env.local"], { cwd: root });
  ok(".env.local is git-ignored");
} catch {
  fail(".env.local is NOT git-ignored", "Add `.env*` to .gitignore before committing anything");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const siteUrl = env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

let projectRef = null;
if (!url)
  fail(
    "NEXT_PUBLIC_SUPABASE_URL is empty",
    "Supabase Dashboard → Connect (or Project Settings → Data API) → Project URL",
  );
else {
  try {
    const u = new URL(url);
    const m = u.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
    if (u.protocol !== "https:") fail("Project URL must start with https://");
    else if (u.pathname !== "/" && u.pathname !== "")
      fail("Project URL must not have a path", "Use https://<ref>.supabase.co (no /rest/v1)");
    else if (m) {
      projectRef = m[1];
      ok(`Project URL looks valid (project ref ${projectRef})`);
    } else warn("Project URL is not a standard https://<ref>.supabase.co address (custom domain?)");
  } catch {
    fail("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
  }
}

const pubKind = keyKind(publishable);
if (pubKind === "publishable" || pubKind === "legacy-anon") ok(`Publishable key present (${pubKind})`);
else if (pubKind === "missing")
  fail("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is empty", "Project Settings → API Keys → Publishable key");
else if (pubKind === "secret" || pubKind === "legacy-service-role")
  fail(
    "DANGER: a SECRET key is in NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — it would be shipped to every browser",
    "Replace it with the publishable key, and rotate the secret key in the dashboard if it was ever deployed",
  );
else warn("Publishable key format not recognised (expected sb_publishable_…)");

const secKind = keyKind(secret);
if (secKind === "secret" || secKind === "legacy-service-role") ok(`Secret key present (${secKind}, server-only)`);
else if (secKind === "missing")
  warn(
    "SUPABASE_SECRET_KEY is empty — database/storage checks below will be skipped",
    "Project Settings → API Keys → Secret keys",
  );
else if (secKind === "publishable" || secKind === "legacy-anon")
  fail("SUPABASE_SECRET_KEY contains a publishable key", "Use the secret key (sb_secret_…)");
else warn("Secret key format not recognised (expected sb_secret_…)");

for (const name of Object.keys(env)) {
  if (name.startsWith("NEXT_PUBLIC_") && /SECRET|SERVICE_ROLE|PRIVATE/.test(name) && env[name])
    fail(`${name} is public but looks secret`, "Variables starting with NEXT_PUBLIC_ are sent to the browser");
}

try {
  new URL(siteUrl);
  ok(`NEXT_PUBLIC_SITE_URL = ${siteUrl}`);
} catch {
  fail("NEXT_PUBLIC_SITE_URL is not a valid URL");
}

if (!url || !publishable || results.fail > 0) finish();

/* ------------------------------------------------------------- network -- */

const clientOpts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const anon = createClient(url, publishable, clientOpts);
const admin = secret && results.fail === 0 ? createClient(url, secret, clientOpts) : null;

section("Authentication");
try {
  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishable } });
  if (res.status === 401 || res.status === 403) {
    fail("Supabase rejected the publishable key", "Check the key belongs to this project and hasn't been revoked");
    finish();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const settings = await res.json();
  ok("Auth service reachable with the publishable key");
  if (settings.external?.email) ok("Email + password sign-in is enabled");
  else fail("Email provider is disabled", "Authentication → Sign In / Providers → Email → enable");
  if (settings.disable_signup)
    fail("New sign-ups are disabled", "Authentication → Sign In / Providers → allow new users to sign up");
  else ok("Sign-ups are allowed");
  if (settings.mailer_autoconfirm)
    warn(
      "Email confirmation is OFF — users are signed in immediately after sign-up",
      "Fine for testing; turn on 'Confirm email' for production",
    );
  else ok("Email confirmation is ON (users must click the link in their email)");
} catch (error) {
  fail(`Could not reach ${url}/auth/v1 (${error.message})`, "Check the Project URL and that the project is not paused");
  finish();
}
console.log(
  `  · Not checkable via API — confirm in the dashboard: Authentication → URL Configuration\n` +
    `      Site URL = ${siteUrl}\n      Redirect URLs include ${siteUrl}/auth/confirm`,
);

section("Database (migrations)");
const TABLES = [
  "profiles",
  "workspaces",
  "workspace_members",
  "workspace_invitations",
  "workspace_counters",
  "clients",
  "projects",
  "project_members",
  "tasks",
  "assets",
  "review_comments",
  "approvals",
  "revisions",
  "ai_generations",
  "invoices",
  "invoice_items",
  "payments",
  "notifications",
  "activity_log",
];
const MISSING = new Set(["PGRST205", "42P01", "PGRST106"]);

{
  const { error } = await anon.from("workspaces").select("id").limit(1);
  if (!error) fail("Anonymous visitors can query tables", "Apply the migrations: npx supabase db push");
  else if (MISSING.has(error.code))
    fail("Tables not found — the migrations have not been applied", "npx supabase db push");
  else if (error.code === "42501") ok("Anonymous visitors are denied table access");
  else warn(`Unexpected response for anonymous query: ${error.code ?? ""} ${error.message}`);
}

if (admin) {
  const missing = [];
  for (const table of TABLES) {
    const { error } = await admin.from(table).select("*").limit(1);
    if (error) missing.push(`${table} (${error.code ?? error.message})`);
  }
  if (missing.length === 0) ok(`All ${TABLES.length} tables exist and are reachable`);
  else fail(`Missing or unreachable tables: ${missing.join(", ")}`, "npx supabase db push");

  // Called without a user, so the function exists only if it rejects with "Not authenticated".
  const { error } = await admin.rpc("create_workspace", { p_name: "verify", p_slug: "verify-check" });
  if (error?.message?.includes("Not authenticated")) ok("RPC functions installed (create_workspace)");
  else if (error?.code === "PGRST202") fail("RPC create_workspace not found", "npx supabase db push");
  else fail(`Unexpected create_workspace result: ${error ? `${error.code} ${error.message}` : "no error"}`);

  {
    const { data, error } = await admin.rpc("get_invitation", { p_token: "x".repeat(43) });
    if (!error && data === null) ok("Phase 2 migration installed (get_invitation)");
    else if (error?.code === "PGRST202") fail("Phase 2 migration not applied", "npx supabase db push");
    else fail(`Unexpected get_invitation result: ${error ? `${error.code} ${error.message}` : JSON.stringify(data)}`);
  }

  section("Storage");
  const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
  if (bucketError) fail(`Could not list buckets: ${bucketError.message}`);
  else
    for (const id of ["project-assets", "avatars"]) {
      const b = buckets.find((x) => x.id === id);
      if (!b) fail(`Bucket "${id}" missing`, "npx supabase db push");
      else if (b.public)
        fail(`Bucket "${id}" is PUBLIC — it must be private`, "Storage → bucket → Edit → turn off Public");
      else ok(`Bucket "${id}" exists and is private`);
    }
} else {
  console.log("  · Skipped table/RPC/storage checks (no secret key)");
}

/* ----------------------------------------------------------------- e2e -- */

if (E2E) {
  section("End-to-end (throwaway users, cleaned up afterwards)");
  if (!admin || results.fail > 0) {
    fail("Skipped: needs a valid secret key and no failures above");
  } else {
    const tag = randomBytes(4).toString("hex");
    const password = `Verify-${randomBytes(12).toString("base64url")}1`;
    const users = [];
    let workspaceId = null;
    try {
      for (const who of ["a", "b", "c"]) {
        const { data, error } = await admin.auth.admin.createUser({
          email: `cf-verify-${tag}-${who}@example.com`,
          password,
          email_confirm: true,
          user_metadata: { full_name: `Verify ${who.toUpperCase()}` },
        });
        if (error) throw new Error(`create test user: ${error.message}`);
        users.push(data.user);
      }
      ok("Created three throwaway users (pre-confirmed, no emails sent)");

      const { data: profile } = await admin.from("profiles").select("full_name").eq("id", users[0].id).maybeSingle();
      if (profile?.full_name === "Verify A") ok("Profile created automatically by the sign-up trigger");
      else
        fail(
          "Profile row was not created for the new user",
          "The on_auth_user_created trigger is missing — re-run db push",
        );

      const signIn = async (user) => {
        const client = createClient(url, publishable, clientOpts);
        const { error } = await client.auth.signInWithPassword({ email: user.email, password });
        if (error) throw new Error(`sign in: ${error.message}`);
        return client;
      };
      const a = await signIn(users[0]);
      const b = await signIn(users[1]);
      ok("Email + password sign-in works");

      const { data: claims } = await a.auth.getClaims();
      if (claims?.claims?.sub === users[0].id) ok("Session JWT verifies (getClaims)");
      else fail("getClaims() did not return the signed-in user");

      const { data: wsId, error: wsError } = await a.rpc("create_workspace", {
        p_name: `Verify ${tag}`,
        p_slug: `cf-verify-${tag}`,
      });
      if (wsError) throw new Error(`create_workspace: ${wsError.code} ${wsError.message}`);
      workspaceId = wsId;
      ok("User A created a workspace");

      const { data: own } = await a.from("workspace_members").select("role").eq("workspace_id", wsId).maybeSingle();
      if (own?.role === "owner") ok("User A is the workspace owner");
      else fail("Owner membership missing");

      const { error: ovError } = await a.rpc("workspace_overview", { p_workspace: wsId });
      if (!ovError) ok("Dashboard overview loads for the owner");
      else fail(`workspace_overview failed: ${ovError.message}`);

      const { data: seen } = await b.from("workspaces").select("id").eq("id", wsId);
      if (seen?.length === 0) ok("User B cannot see User A's workspace (tenant isolation)");
      else fail("TENANT ISOLATION BROKEN: user B can read user A's workspace");

      const { data: changed } = await b.from("workspaces").update({ name: "pwned" }).eq("id", wsId).select("id");
      if (!changed?.length) ok("User B cannot modify User A's workspace");
      else fail("TENANT ISOLATION BROKEN: user B modified user A's workspace");

      const { error: bOverview } = await b.rpc("workspace_overview", { p_workspace: wsId });
      if (bOverview) ok("User B is denied User A's dashboard data");
      else fail("User B could read User A's dashboard overview");

      /* ------------------------------ Phase 2 ------------------------------ */
      const c = await signIn(users[2]);
      const hash = (t) => createHash("sha256").update(t).digest("hex");
      const token = randomBytes(32).toString("base64url");

      const { error: invError } = await a.from("workspace_invitations").insert({
        workspace_id: wsId,
        email: users[2].email,
        role: "member",
        token_hash: hash(token),
        invited_by: users[0].id,
      });
      if (invError) throw new Error(`create invitation: ${invError.message}`);
      ok("Owner created an invitation (only the token hash is stored)");

      const { data: info } = await anon.rpc("get_invitation", { p_token: token });
      if (info?.status === "pending" && info.workspace_name === `Verify ${tag}`)
        ok("Invite page lookup works for a signed-out visitor");
      else fail(`get_invitation returned ${JSON.stringify(info)}`);

      const { error: accError } = await c.rpc("accept_invitation", { p_token: token });
      if (accError) throw new Error(`accept_invitation: ${accError.message}`);
      const { data: cMember } = await c
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", wsId)
        .eq("user_id", users[2].id)
        .maybeSingle();
      if (cMember?.role === "member") ok("Invitee accepted and joined as Member");
      else fail("Invitee membership missing after accepting");

      const { error: reuse } = await b.rpc("accept_invitation", { p_token: token });
      if (reuse) ok("A used invitation cannot be accepted again");
      else fail("An invitation was accepted twice");

      const { error: roleError } = await a
        .from("workspace_members")
        .update({ role: "manager" })
        .eq("workspace_id", wsId)
        .eq("user_id", users[2].id);
      if (roleError) fail(`Owner could not change a role: ${roleError.message}`);
      else ok("Owner promoted the invitee to Manager");

      const { error: mgrInvite } = await c.from("workspace_invitations").insert({
        workspace_id: wsId,
        email: `cf-verify-${tag}-x@example.com`,
        role: "member",
        token_hash: hash(randomBytes(32).toString("base64url")),
        invited_by: users[2].id,
      });
      if (mgrInvite) ok("Managers cannot send invitations (admins only)");
      else fail("A manager was able to create an invitation");

      const { data: client, error: clientError } = await c
        .from("clients")
        .insert({ workspace_id: wsId, name: "Verify Client", email: "client@example.com", created_by: users[2].id })
        .select("id")
        .single();
      if (clientError) throw new Error(`create client: ${clientError.message}`);
      ok("Manager created a client");

      const { data: project, error: projectError } = await c
        .from("projects")
        .insert({ workspace_id: wsId, client_id: client.id, name: "Verify Project", created_by: users[2].id })
        .select("id")
        .single();
      if (projectError) throw new Error(`create project: ${projectError.message}`);
      const { error: statusError } = await c.from("projects").update({ status: "in_progress" }).eq("id", project.id);
      if (statusError) fail(`Project status update failed: ${statusError.message}`);
      else ok("Manager created a project and moved it to In progress");

      const { data: task, error: taskError } = await c
        .from("tasks")
        .insert({
          workspace_id: wsId,
          project_id: project.id,
          title: "Verify Task",
          assignee_id: users[2].id,
          created_by: users[2].id,
        })
        .select("id, position")
        .single();
      if (taskError) throw new Error(`create task: ${taskError.message}`);
      ok("Task created and assigned to a team member");

      const { error: badAssignee } = await c.from("tasks").update({ assignee_id: users[1].id }).eq("id", task.id);
      if (badAssignee) ok("Tasks cannot be assigned to someone outside the workspace");
      else fail("A task was assigned to a user from another workspace");

      const { data: doneTask } = await c
        .from("tasks")
        .update({ status: "done" })
        .eq("id", task.id)
        .select("completed_at")
        .single();
      if (doneTask?.completed_at) ok("Completing a task records completed_at");
      else fail("completed_at was not set when the task was completed");

      const { data: log } = await a.from("activity_log").select("action").eq("workspace_id", wsId);
      const actions = new Set((log ?? []).map((l) => l.action));
      const expected = [
        "invitation.created",
        "member.joined",
        "member.role_changed",
        "client.created",
        "project.created",
        "project.status_changed",
        "task.created",
        "task.completed",
      ];
      const missing = expected.filter((x) => !actions.has(x));
      if (missing.length === 0) ok("Activity log recorded every Phase 2 event");
      else fail(`Activity log is missing: ${missing.join(", ")}`);

      const [bClients, bProjects, bTasks] = await Promise.all([
        b.from("clients").select("id").eq("id", client.id),
        b.from("projects").select("id").eq("id", project.id),
        b.from("tasks").select("id").eq("id", task.id),
      ]);
      const leaked = [bClients, bProjects, bTasks].some((r) => (r.data ?? []).length > 0);
      const { data: bUpdate } = await b.from("projects").update({ name: "pwned" }).eq("id", project.id).select("id");
      if (!leaked && !bUpdate?.length) ok("Other agencies cannot read or change clients, projects or tasks");
      else fail("TENANT ISOLATION BROKEN for Phase 2 data");
    } catch (error) {
      fail(`End-to-end test stopped: ${error.message}`);
    } finally {
      if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
      for (const u of users) await admin.auth.admin.deleteUser(u.id);
      if (users.length) console.log("  · Cleaned up test users and workspace");
    }
  }
}

finish();

function finish() {
  console.log(`\n${results.pass} passed, ${results.warn} warnings, ${results.fail} failed`);
  if (results.fail === 0 && !E2E) console.log("Next: npm run verify:supabase -- --e2e");
  process.exit(results.fail ? 1 : 0);
}
