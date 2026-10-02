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
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Upload as TusUpload } from "tus-js-client";
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

  {
    const { data, error } = await admin.rpc("asset_upload_constraints");
    if (error?.code === "PGRST202") fail("Phase 3 migration not applied", "npx supabase db push");
    else if (error) fail(`Unexpected asset_upload_constraints result: ${error.code} ${error.message}`);
    else {
      ok("Phase 3 migration installed (asset_upload_constraints)");
      const types = data?.allowed_mime_types ?? [];
      if (types.includes("video/mp4") && !types.includes("application/zip"))
        ok(`Bucket allows ${types.length} media types only`);
      else fail("project-assets has no file type allowlist", "npx supabase db push");
      const bucketLimit = data?.file_size_limit ? Number(data.file_size_limit) : null;
      console.log(
        `  · Bucket upload limit: ${bucketLimit ? `${Math.round(bucketLimit / 1048576)} MB` : "not set on the bucket"}`,
      );
      const configured = Number(env.STORAGE_MAX_UPLOAD_BYTES);
      if (Number.isSafeInteger(configured) && configured > 0) {
        ok(`STORAGE_MAX_UPLOAD_BYTES = ${Math.round(configured / 1048576)} MB (checked before uploads start)`);
      } else {
        warn(
          "Project-wide upload limit unknown (plan dependent, not readable via the API)",
          "Optional: set STORAGE_MAX_UPLOAD_BYTES to Dashboard → Storage → Settings → upload file size limit",
        );
      }
    }
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
    const channels = [];
    let workspaceId = null;
    try {
      for (const who of ["a", "b", "c", "d"]) {
        const { data, error } = await admin.auth.admin.createUser({
          email: `cf-verify-${tag}-${who}@example.com`,
          password,
          email_confirm: true,
          user_metadata: { full_name: `Verify ${who.toUpperCase()}` },
        });
        if (error) throw new Error(`create test user: ${error.message}`);
        users.push(data.user);
      }
      ok("Created four throwaway users (pre-confirmed, no emails sent)");

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
      /* ------------------------------ Phase 3 ------------------------------ */
      const BUCKET = "project-assets";
      const endpoint = resumableEndpoint(url);
      const tokenOf = async (client) => (await client.auth.getSession()).data.session?.access_token;
      const sha = (buf) => createHash("sha256").update(buf).digest("hex");
      const assetPath = (id, file) => `${wsId}/${project.id}/${id}/${file}`;
      const thumbOf = (p) => p.replace(/[^/]+$/, "thumbnail.jpg");

      const resumableUpload = async (client, objectName, contentType, bytes) => {
        const token = await tokenOf(client);
        let posts = 0;
        await new Promise((resolve, reject) => {
          const up = new TusUpload(bytes, {
            endpoint,
            chunkSize: 6 * 1024 * 1024,
            retryDelays: [0, 2000, 5000],
            uploadDataDuringCreation: true,
            headers: { apikey: publishable, authorization: `Bearer ${token}`, "x-upsert": "true" },
            metadata: { bucketName: BUCKET, objectName, contentType, cacheControl: "3600" },
            onBeforeRequest: (req) => {
              if (req.getMethod() === "POST") posts += 1;
            },
            onError: (e) => reject(new Error(`resumable upload failed: ${e.message}`)),
            onSuccess: () => resolve(),
          });
          up.start();
        });
        return posts;
      };
      const newAsset = async (client, uploaderId, { file, mime, size, root = null }) => {
        const id = randomUUID();
        const storage_path = assetPath(id, file);
        const { error } = await client.from("assets").insert({
          id,
          workspace_id: wsId,
          project_id: project.id,
          name: file,
          kind: mime.split("/")[0] === "application" ? "document" : mime.split("/")[0],
          storage_path,
          mime_type: mime,
          size_bytes: size,
          uploaded_by: uploaderId,
          root_asset_id: root,
        });
        if (error) throw new Error(`create asset row: ${error.message}`);
        return { id, path: storage_path };
      };

      // 1. Resumable upload of a real 7 MB file (two 6 MB-chunk requests).
      const bytes = randomBytes(7 * 1024 * 1024);
      const cut = await newAsset(c, users[2].id, { file: "verify-cut.mp4", mime: "video/mp4", size: bytes.length });
      const posts = await resumableUpload(c, cut.path, "video/mp4", bytes);
      if (posts === 1) ok("Resumable upload completed (7 MB in 6 MB chunks, one upload session)");
      else fail(`Resumable upload used ${posts} upload sessions`);
      const thumb = randomBytes(2048);
      const { error: thumbError } = await c.storage
        .from(BUCKET)
        .upload(thumbOf(cut.path), thumb, { contentType: "image/jpeg" });
      if (thumbError) fail(`Thumbnail upload failed: ${thumbError.message}`);
      else ok("Thumbnail uploaded to the private bucket");

      // 2. Storage rules during the upload.
      const { error: outsiderUpload } = await b.storage
        .from(BUCKET)
        .upload(cut.path, randomBytes(10), { contentType: "video/mp4", upsert: true });
      const { error: strayUpload } = await c.storage
        .from(BUCKET)
        .upload(`${wsId}/${project.id}/${randomUUID()}/stray.mp4`, randomBytes(10), { contentType: "video/mp4" });
      if (outsiderUpload && strayUpload) ok("Uploads only reach the caller's own in-progress asset path");
      else fail("STORAGE RULES BROKEN: an upload outside the caller's asset was accepted");

      // 3. Finalize: the database checks the stored object's real size and type.
      const { data: fin, error: finError } = await c.rpc("finalize_asset_upload", {
        p_asset: cut.id,
        p_duration_seconds: 12.5,
        p_width: 1920,
        p_height: 1080,
        p_frame_rate: 25,
      });
      if (finError) throw new Error(`finalize: ${finError.message}`);
      const { data: stored } = await admin.storage.from(BUCKET).info(cut.path);
      const { data: cutRow } = await c
        .from("assets")
        .select("status, thumbnail_path, size_bytes")
        .eq("id", cut.id)
        .single();
      if (fin?.status === "ready" && cutRow?.status === "ready" && Number(stored?.size) === bytes.length) {
        ok("Finalized after verifying the stored object exists with the exact size");
      } else
        fail(`Finalize/size check failed: status=${cutRow?.status} stored=${stored?.size} expected=${bytes.length}`);
      if (cutRow?.thumbnail_path === thumbOf(cut.path)) ok("Thumbnail path recorded on the asset");
      else fail("Thumbnail path was not recorded");

      const bad = await newAsset(c, users[2].id, { file: "verify-bad.mp4", mime: "video/mp4", size: 5000 });
      await c.storage.from(BUCKET).upload(bad.path, randomBytes(4000), { contentType: "video/mp4" });
      const { error: mismatch } = await c.rpc("finalize_asset_upload", { p_asset: bad.id });
      if (mismatch && /does not match/.test(mismatch.message)) ok("A size mismatch is refused at finalization");
      else fail("A file with the wrong size was accepted");
      await c.storage.from(BUCKET).remove([bad.path]);
      await c.from("assets").delete().eq("id", bad.id);

      const { error: overwrite } = await c.storage
        .from(BUCKET)
        .upload(cut.path, randomBytes(10), { contentType: "video/mp4", upsert: true });
      if (overwrite) ok("A completed file cannot be overwritten");
      else fail("A completed file was overwritten");

      // 4. Signed URL download returns the exact bytes; other agencies get nothing.
      const { data: signedUrl, error: signError } = await c.storage.from(BUCKET).createSignedUrl(cut.path, 60);
      if (signError) throw new Error(`signed URL: ${signError.message}`);
      const downloaded = Buffer.from(await (await fetch(signedUrl.signedUrl)).arrayBuffer());
      if (sha(downloaded) === sha(bytes)) ok("Signed URL download returns the exact uploaded bytes");
      else fail("Downloaded bytes differ from the upload");
      const [{ data: bAsset }, { error: bDownload }, { error: bSign }] = await Promise.all([
        b.from("assets").select("id").eq("id", cut.id),
        b.storage.from(BUCKET).download(cut.path),
        b.storage.from(BUCKET).createSignedUrl(cut.path, 60),
      ]);
      if (!bAsset?.length && bDownload && bSign) ok("Another workspace cannot read, download or sign the file");
      else fail("TENANT ISOLATION BROKEN: another workspace reached the file");

      // 5. Versions.
      const v2Bytes = randomBytes(64 * 1024);
      const v2 = await newAsset(c, users[2].id, {
        file: "verify-cut-v2.mp4",
        mime: "video/mp4",
        size: v2Bytes.length,
        root: cut.id,
      });
      await resumableUpload(c, v2.path, "video/mp4", v2Bytes);
      const { error: v2Fin } = await c.rpc("finalize_asset_upload", { p_asset: v2.id, p_duration_seconds: 2 });
      const { data: v2Row } = await c.from("assets").select("version_number, root_asset_id").eq("id", v2.id).single();
      if (!v2Fin && v2Row?.version_number === 2 && v2Row.root_asset_id === cut.id)
        ok("New version numbered 2 and linked to its original");
      else fail(`Version creation failed: ${v2Fin?.message ?? JSON.stringify(v2Row)}`);
      const nested = randomUUID();
      const { error: nestedError } = await c.from("assets").insert({
        id: nested,
        workspace_id: wsId,
        project_id: project.id,
        name: "x.mp4",
        kind: "video",
        storage_path: assetPath(nested, "x.mp4"),
        mime_type: "video/mp4",
        size_bytes: 10,
        uploaded_by: users[2].id,
        root_asset_id: v2.id,
      });
      if (nestedError) ok("A version of a version is refused (versions attach to the original)");
      else fail("A version was attached to another version");

      // 6. Client user (role client) for privacy checks.
      const clientToken = randomBytes(32).toString("base64url");
      const { error: clientInvite } = await a.from("workspace_invitations").insert({
        workspace_id: wsId,
        email: users[3].email,
        role: "client",
        client_id: client.id,
        token_hash: hash(clientToken),
        invited_by: users[0].id,
      });
      if (clientInvite) throw new Error(`client invitation: ${clientInvite.message}`);
      const d = await signIn(users[3]);
      const { error: clientAccept } = await d.rpc("accept_invitation", { p_token: clientToken });
      if (clientAccept) throw new Error(`client accept: ${clientAccept.message}`);
      await c.from("projects").update({ client_visible: true }).eq("id", project.id);
      await c.from("assets").update({ shared_with_client: true }).eq("id", v2.id);

      // 7. Realtime: staff (a) and client (d) subscribe; outsider (b) must receive nothing.
      const subscribe = async (client, label) => {
        client.realtime.setAuth(await tokenOf(client));
        const events = [];
        const channel = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Realtime ${label}: subscription timed out`)), 15000);
          const ch = client
            .channel(`verify-${label}-${tag}`)
            .on(
              "postgres_changes",
              { event: "INSERT", schema: "public", table: "review_comments", filter: `asset_id=eq.${v2.id}` },
              (p) => events.push(p.new),
            )
            .subscribe((status, err) => {
              if (status === "SUBSCRIBED") {
                clearTimeout(timer);
                resolve(ch);
              } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                clearTimeout(timer);
                reject(new Error(`Realtime ${label}: ${status} ${err?.message ?? ""}`));
              }
            });
        });
        channels.push([client, channel]);
        return events;
      };
      const [aEvents, dEvents, bEvents] = await Promise.all([
        subscribe(a, "staff"),
        subscribe(d, "client"),
        subscribe(b, "outsider"),
      ]);
      ok("Realtime subscriptions established for staff, client and outsider sessions");

      const { data: internal, error: internalError } = await c
        .from("review_comments")
        .insert({
          workspace_id: wsId,
          asset_id: v2.id,
          author_id: users[2].id,
          body: "Internal: grade is off",
          is_internal: true,
        })
        .select("id")
        .single();
      const { data: pub, error: pubError } = await c
        .from("review_comments")
        .insert({
          workspace_id: wsId,
          asset_id: v2.id,
          author_id: users[2].id,
          body: "Logo too small",
          timestamp_seconds: 1.25,
          annotation: { x: 0.5, y: 0.25 },
        })
        .select("id, timestamp_seconds, annotation")
        .single();
      if (internalError || pubError) throw new Error(`comments: ${(internalError ?? pubError).message}`);
      if (Number(pub.timestamp_seconds) === 1.25 && pub.annotation?.x === 0.5)
        ok("Timestamped comment with a frame pin saved");
      else fail("Timestamp/annotation not stored as sent");

      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && (aEvents.length < 2 || dEvents.length < 1))
        await new Promise((r) => setTimeout(r, 250));
      await new Promise((r) => setTimeout(r, 1500)); // allow any (incorrect) extra deliveries to arrive
      const aIds = aEvents.map((e) => e.id);
      if (aIds.includes(internal.id) && aIds.includes(pub.id))
        ok("A second authorized session received both comments live via Realtime");
      else
        fail(
          `Realtime delivery to staff failed (received ${aEvents.length} of 2)`,
          "Check Database → Publications → supabase_realtime includes review_comments",
        );
      const dIds = dEvents.map((e) => e.id);
      if (dIds.includes(pub.id) && !dIds.includes(internal.id))
        ok("The client received the public comment live but not the internal note");
      else fail(`PRIVACY: client Realtime events = ${JSON.stringify(dIds)}`);
      if (bEvents.length === 0) ok("Another workspace received no Realtime events");
      else fail("TENANT ISOLATION BROKEN: another workspace received Realtime comment events");

      // 8. Replies, edits, resolve, privacy, timestamp validation.
      const { error: replyError } = await a
        .from("review_comments")
        .insert({ workspace_id: wsId, asset_id: v2.id, parent_id: pub.id, author_id: users[0].id, body: "Will fix" });
      const { data: edited } = await c
        .from("review_comments")
        .update({ body: "Logo too small (edited)" })
        .eq("id", pub.id)
        .select("edited_at")
        .single();
      const { error: foreignEdit } = await a.from("review_comments").update({ body: "hijack" }).eq("id", pub.id);
      const { data: resolved } = await a
        .from("review_comments")
        .update({ resolved_at: new Date().toISOString() })
        .eq("id", pub.id)
        .select("resolved_by")
        .single();
      // RLS hides other people's comments from a client's UPDATE (0 rows), or the trigger refuses it.
      const { data: clientResolveRows, error: clientResolveError } = await d
        .from("review_comments")
        .update({ resolved_at: null })
        .eq("id", pub.id)
        .select("id");
      const clientResolve = Boolean(clientResolveError) || (clientResolveRows ?? []).length === 0;
      if (!replyError) ok("Threaded reply saved");
      else fail(`Reply failed: ${replyError.message}`);
      if (edited?.edited_at && foreignEdit) ok("The author edited the comment; another user could not");
      else fail("Comment edit rules not enforced");
      if (resolved?.resolved_by === users[0].id && clientResolve)
        ok("Staff resolved the thread (resolver recorded); the client could not");
      else fail("Resolve rules not enforced");
      const { data: clientView } = await d.from("review_comments").select("id, is_internal").eq("asset_id", v2.id);
      if (clientView?.length === 2 && clientView.every((r) => !r.is_internal))
        ok("Internal notes stay private from the client");
      else fail(`PRIVACY: client sees ${JSON.stringify(clientView)}`);
      const { error: lateError } = await c.from("review_comments").insert({
        workspace_id: wsId,
        asset_id: cut.id,
        author_id: users[2].id,
        body: "Too late",
        timestamp_seconds: 99,
      });
      if (lateError && /past the end/.test(lateError.message)) ok("Timestamps past the media duration are refused");
      else fail("A timestamp beyond the media duration was accepted");

      // 9. Deletion removes files, thumbnails, versions and rows.
      const paths = [cut.path, thumbOf(cut.path), v2.path, thumbOf(v2.path)];
      const { error: removeError } = await c.storage.from(BUCKET).remove(paths);
      const leftovers = [];
      for (const folder of [cut.path, v2.path].map((p) => p.replace(/\/[^/]+$/, ""))) {
        const { data: files } = await admin.storage.from(BUCKET).list(folder);
        leftovers.push(...(files ?? []).filter((f) => f.id !== null));
      }
      const { error: deleteRowError } = await c.from("assets").delete().eq("id", cut.id);
      const { data: rowsLeft } = await admin.from("assets").select("id").in("id", [cut.id, v2.id]);
      if (!removeError && leftovers.length === 0 && !deleteRowError && rowsLeft?.length === 0) {
        ok("Deleting removed every file, thumbnail and version, then the records");
      } else fail(`Deletion incomplete: storage=${removeError?.message ?? leftovers.length} rows=${rowsLeft?.length}`);

      const { data: p3log } = await a.from("activity_log").select("action").eq("workspace_id", wsId);
      const p3actions = new Set((p3log ?? []).map((l) => l.action));
      const p3missing = [
        "asset.uploaded",
        "asset.version_added",
        "comment.created",
        "comment.resolved",
        "asset.deleted",
      ].filter((x) => !p3actions.has(x));
      if (p3missing.length === 0) ok("Activity log recorded uploads, versions, comments, resolutions and deletion");
      else fail(`Activity log is missing: ${p3missing.join(", ")}`);
    } catch (error) {
      fail(`End-to-end test stopped: ${error.message}`);
    } finally {
      for (const [client, channel] of channels) await client.removeChannel(channel).catch(() => undefined);
      // Storage first (it is not removed by database cascades), then rows, then users.
      let storageLeft = 0;
      if (workspaceId) storageLeft = await removeStoragePrefix(admin, "project-assets", workspaceId);
      if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
      for (const u of users) await admin.auth.admin.deleteUser(u.id);
      if (users.length) {
        if (storageLeft === 0) console.log("  · Cleaned up test users, workspace and storage objects");
        else
          fail(
            `Cleanup left ${storageLeft} storage objects under ${workspaceId}/ in project-assets — remove them in the dashboard`,
          );
      }
    }
  }
}

finish();

/** Same rule as src/lib/media/file-types.ts resumableEndpoint(). */
function resumableEndpoint(supabaseUrl) {
  const u = new URL(supabaseUrl);
  const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
  return `${m ? `https://${m[1]}.storage.supabase.co` : u.origin}/storage/v1/upload/resumable`;
}

/** Recursively removes every object under `prefix`; returns how many remain afterwards. */
async function removeStoragePrefix(adminClient, bucket, prefix) {
  const files = [];
  const walk = async (folder) => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await adminClient.storage.from(bucket).list(folder, { limit: 1000, offset });
      if (error || !data) return;
      for (const entry of data) {
        if (entry.id === null) await walk(`${folder}/${entry.name}`);
        else files.push(`${folder}/${entry.name}`);
      }
      if (data.length < 1000) return;
    }
  };
  await walk(prefix);
  for (let i = 0; i < files.length; i += 1000) await adminClient.storage.from(bucket).remove(files.slice(i, i + 1000));
  const remaining = [];
  const recount = async (folder) => {
    const { data } = await adminClient.storage.from(bucket).list(folder, { limit: 1000 });
    for (const entry of data ?? []) {
      if (entry.id === null) await recount(`${folder}/${entry.name}`);
      else remaining.push(entry.name);
    }
  };
  await recount(prefix);
  return remaining.length;
}

function finish() {
  console.log(`\n${results.pass} passed, ${results.warn} warnings, ${results.fail} failed`);
  if (results.fail === 0 && !E2E) console.log("Next: npm run verify:supabase -- --e2e");
  process.exit(results.fail ? 1 : 0);
}
