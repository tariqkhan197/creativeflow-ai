-- =============================================================================
-- Phase 5: AI Studio (database)
--
-- An ai_generations row is one script or storyboard document. Every call to
-- the AI model (first draft, storyboard, scene rewrite) is recorded in the
-- append-only ai_usage_events table, which also drives the rate limits.
--
--   * Users never write AI results. start_ai_generation() / start_ai_revision()
--     (signed-in staff) check access and limits and create pending records;
--     the server calls the model and records the outcome with
--     finish_ai_run(), which only the server's secret-key role
--     (service_role) may execute (decision D1).
--   * Status, original output, model, token usage and errors can't be set or
--     changed by users. Users may edit the title, the project link and,
--     once completed, the document.
--   * Limits (D4): 50 model calls per workspace per 24 hours and 20 per user
--     per hour across all workspaces, checked under advisory locks so
--     concurrent requests can't exceed them. Failed calls count too.
--   * A run still pending after 15 minutes is marked failed (timed out) the
--     next time anyone in the workspace starts a run, and its late result is
--     refused.
--   * All staff roles may use AI Studio; the creator or a manager may edit and
--     delete (D6, unchanged RLS). Clients never see any of it.
-- =============================================================================

create type public.ai_usage_purpose as enum ('script', 'storyboard', 'scene');
create type public.ai_usage_status as enum ('pending', 'succeeded', 'failed');

-- -----------------------------------------------------------------------------
-- ai_generations: editable document next to the immutable model output
-- -----------------------------------------------------------------------------
alter table public.ai_generations
  add constraint ai_generations_id_workspace_key unique (id, workspace_id),
  add column source_generation_id uuid,
  add column document jsonb,
  add column completed_at timestamptz,
  add column edited_by uuid references auth.users (id) on delete set null,
  add column edited_at timestamptz,
  add constraint ai_generations_source_fkey foreign key (source_generation_id, workspace_id)
    references public.ai_generations (id, workspace_id) on delete set null (source_generation_id),
  add constraint ai_generations_source_kind check (source_generation_id is null or kind = 'storyboard'),
  add constraint ai_generations_output_shape check (
    output is null or (jsonb_typeof(output) = 'object' and octet_length(output::text) <= 262144)
  ),
  add constraint ai_generations_document_shape check (
    document is null or (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 262144)
  ),
  add constraint ai_generations_input_shape check (
    jsonb_typeof(input) = 'object' and octet_length(input::text) <= 65536
  ),
  add constraint ai_generations_model_length check (model is null or char_length(model) between 1 and 100),
  add constraint ai_generations_error_length check (error is null or char_length(error) <= 2000),
  add constraint ai_generations_tokens_nonnegative check (
    coalesce(input_tokens, 0) >= 0 and coalesce(output_tokens, 0) >= 0
  );

create index ai_generations_project_idx on public.ai_generations (project_id) where project_id is not null;
create index ai_generations_source_idx on public.ai_generations (source_generation_id)
  where source_generation_id is not null;

-- Only start_ai_generation() creates rows.
drop policy "ai: staff create" on public.ai_generations;

-- -----------------------------------------------------------------------------
-- ai_usage_events: one row per model call (append-only for users)
-- -----------------------------------------------------------------------------
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  generation_id uuid,
  user_id uuid references auth.users (id) on delete set null,
  purpose public.ai_usage_purpose not null,
  status public.ai_usage_status not null default 'pending',
  model text check (model is null or char_length(model) between 1 and 100),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  error text check (error is null or char_length(error) <= 2000),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (generation_id, workspace_id)
    references public.ai_generations (id, workspace_id) on delete set null (generation_id)
);

create index ai_usage_events_workspace_idx on public.ai_usage_events (workspace_id, created_at desc);
create index ai_usage_events_user_idx on public.ai_usage_events (user_id, created_at desc);
create index ai_usage_events_generation_idx on public.ai_usage_events (generation_id)
  where generation_id is not null;

alter table public.ai_usage_events enable row level security;

create policy "ai usage: staff read" on public.ai_usage_events
  for select to authenticated using (private.is_staff(workspace_id));
-- No insert/update/delete policies: only the functions below write usage.

revoke all on public.ai_usage_events from anon;
grant select on public.ai_usage_events to authenticated;
grant all on public.ai_usage_events to service_role;

-- -----------------------------------------------------------------------------
-- Trusted writers
-- -----------------------------------------------------------------------------
-- The Data API runs user requests as `anon` / `authenticated`. Inside the
-- SECURITY DEFINER functions below, in foreign-key actions, and for the
-- server's secret key (service_role) the current role is different. API
-- callers can't change their role.
create function private.ai_trusted_writer()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user not in ('anon', 'authenticated');
$$;

grant execute on function private.ai_trusted_writer() to authenticated;

-- Security invoker on purpose: see private.ai_trusted_writer().
create function private.prepare_ai_generation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if private.ai_trusted_writer() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'AI generations are created through AI Studio' using errcode = '42501';
  end if;

  -- UPDATE by a signed-in user: only the title, the project and (once
  -- completed) the document may change.
  if new.id <> old.id or new.workspace_id <> old.workspace_id or new.kind <> old.kind
     or new.prompt <> old.prompt or new.input <> old.input
     or new.output is distinct from old.output or new.model is distinct from old.model
     or new.status <> old.status or new.error is distinct from old.error
     or new.input_tokens is distinct from old.input_tokens
     or new.output_tokens is distinct from old.output_tokens
     or new.created_by is distinct from old.created_by
     or new.source_generation_id is distinct from old.source_generation_id
     or new.completed_at is distinct from old.completed_at
     or new.created_at <> old.created_at then
    raise exception 'AI results, status and usage are recorded by AI Studio and can''t be changed' using errcode = '42501';
  end if;

  if new.document is distinct from old.document then
    if old.status <> 'completed' then
      raise exception 'Only a completed generation can be edited' using errcode = '23514';
    end if;
    if new.document is null then
      raise exception 'The document can''t be removed' using errcode = '23514';
    end if;
    new.edited_by := (select auth.uid());
    new.edited_at := now();
  else
    new.edited_by := old.edited_by;
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

create trigger ai_generations_prepare before insert or update on public.ai_generations
  for each row execute function private.prepare_ai_generation();

-- -----------------------------------------------------------------------------
-- Limits and stale runs
-- -----------------------------------------------------------------------------
create function private.ai_limits(out workspace_per_day integer, out user_per_hour integer, out stale_after interval)
language sql
immutable
set search_path = ''
as $$
  select 50, 20, interval '15 minutes';
$$;

-- Serializes run starts per workspace and per user, expires stale runs, and
-- enforces the limits. Must be called inside a transaction (the advisory
-- locks are released at its end).
create function private.ai_reserve_run(p_workspace uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  lim record;
  used integer;
begin
  select * into lim from private.ai_limits();

  -- Always workspace first, then user, so two transactions can't deadlock.
  perform pg_advisory_xact_lock(hashtextextended('cf.ai.workspace:' || p_workspace::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('cf.ai.user:' || p_user::text, 0));

  update public.ai_usage_events
  set status = 'failed', error = 'Timed out before the AI result arrived', finished_at = now()
  where workspace_id = p_workspace and status = 'pending' and created_at < now() - lim.stale_after;
  update public.ai_generations
  set status = 'failed', error = 'Timed out before the AI result arrived', completed_at = now()
  where workspace_id = p_workspace and status = 'pending' and created_at < now() - lim.stale_after;

  select count(*) into used from public.ai_usage_events
  where workspace_id = p_workspace and created_at > now() - interval '24 hours';
  if used >= lim.workspace_per_day then
    raise exception 'This workspace has reached its limit of % AI generations in 24 hours. Please try again later.',
      lim.workspace_per_day using errcode = 'P0001', hint = 'ai_limit_workspace';
  end if;

  select count(*) into used from public.ai_usage_events
  where user_id = p_user and created_at > now() - interval '1 hour';
  if used >= lim.user_per_hour then
    raise exception 'You have reached your limit of % AI generations per hour. Please try again later.',
      lim.user_per_hour using errcode = 'P0001', hint = 'ai_limit_user';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- start_ai_generation: a new script, or a storyboard from a completed script
-- -----------------------------------------------------------------------------
create function public.start_ai_generation(
  p_workspace uuid,
  p_kind public.ai_generation_kind,
  p_prompt text,
  p_input jsonb default '{}'::jsonb,
  p_title text default null,
  p_project uuid default null,
  p_source uuid default null
)
returns table (generation_id uuid, usage_event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  src public.ai_generations%rowtype;
  gid uuid;
  eid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_workspace is null or not private.is_staff(p_workspace) then
    raise exception 'Workspace not found' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_prompt, ''))) = 0 then
    raise exception 'Describe what you want to generate' using errcode = '22023';
  end if;
  if p_project is not null
     and not exists (select 1 from public.projects where id = p_project and workspace_id = p_workspace) then
    raise exception 'Choose a project from this workspace' using errcode = '22023';
  end if;

  if p_kind = 'storyboard' then
    select * into src from public.ai_generations where id = p_source and workspace_id = p_workspace;
    if not found or src.kind <> 'script' then
      raise exception 'Choose a script from this workspace for the storyboard' using errcode = '22023';
    end if;
    if src.status <> 'completed' then
      raise exception 'The script must finish generating first' using errcode = '22023';
    end if;
  elsif p_source is not null then
    raise exception 'Only storyboards are based on another generation' using errcode = '22023';
  end if;

  perform private.ai_reserve_run(p_workspace, uid);

  insert into public.ai_generations (workspace_id, project_id, kind, title, prompt, input, created_by, source_generation_id)
  values (p_workspace, p_project, p_kind, nullif(trim(coalesce(p_title, '')), ''), trim(p_prompt),
          coalesce(p_input, '{}'::jsonb), uid, p_source)
  returning id into gid;

  insert into public.ai_usage_events (workspace_id, generation_id, user_id, purpose)
  values (p_workspace, gid, uid, p_kind::text::public.ai_usage_purpose)
  returning id into eid;

  return query select gid, eid;
end;
$$;

-- -----------------------------------------------------------------------------
-- start_ai_revision: rewrite part of a completed generation (e.g. one scene)
-- -----------------------------------------------------------------------------
create function public.start_ai_revision(p_generation uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  g public.ai_generations%rowtype;
  eid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into g from public.ai_generations where id = p_generation;
  if not found or not private.is_staff(g.workspace_id) then
    raise exception 'Generation not found' using errcode = '42501';
  end if;
  -- Same people who may edit it (RLS update policy): the creator or a manager.
  if g.created_by is distinct from uid and not private.can_manage(g.workspace_id) then
    raise exception 'Only the creator or a manager can change this generation' using errcode = '42501';
  end if;
  if g.status <> 'completed' then
    raise exception 'Only a completed generation can be revised' using errcode = '22023';
  end if;

  perform private.ai_reserve_run(g.workspace_id, uid);

  insert into public.ai_usage_events (workspace_id, generation_id, user_id, purpose)
  values (g.workspace_id, g.id, uid, 'scene')
  returning id into eid;
  return eid;
end;
$$;

-- -----------------------------------------------------------------------------
-- finish_ai_run: the server records a model call's outcome (service_role only)
-- -----------------------------------------------------------------------------
create function public.finish_ai_run(
  p_event uuid,
  p_succeeded boolean,
  p_model text,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_output jsonb default null,
  p_document jsonb default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.ai_usage_events%rowtype;
  g public.ai_generations%rowtype;
begin
  select * into ev from public.ai_usage_events where id = p_event for update;
  if not found then
    raise exception 'AI run not found' using errcode = '22023';
  end if;
  if ev.status <> 'pending' then
    raise exception 'This AI run has already finished' using errcode = '22023';
  end if;
  if p_succeeded is null then
    raise exception 'Say whether the run succeeded' using errcode = '22023';
  end if;
  if p_succeeded then
    if ev.purpose in ('script', 'storyboard') and p_output is null then
      raise exception 'A successful run needs its output' using errcode = '22023';
    end if;
    if ev.purpose = 'scene' and p_document is null then
      raise exception 'A successful revision needs the updated document' using errcode = '22023';
    end if;
  elsif char_length(coalesce(trim(p_error), '')) = 0 then
    raise exception 'A failed run needs an error message' using errcode = '22023';
  end if;

  update public.ai_usage_events
  set status = case when p_succeeded then 'succeeded'::public.ai_usage_status else 'failed' end,
      model = p_model, input_tokens = p_input_tokens, output_tokens = p_output_tokens,
      error = case when p_succeeded then null else left(trim(p_error), 2000) end,
      finished_at = now()
  where id = ev.id;

  if ev.generation_id is null then
    return; -- the generation was deleted while the model was working
  end if;
  select * into g from public.ai_generations where id = ev.generation_id for update;

  if ev.purpose in ('script', 'storyboard') then
    if g.status <> 'pending' then
      return;
    end if;
    update public.ai_generations
    set status = case when p_succeeded then 'completed'::public.ai_generation_status else 'failed' end,
        output = case when p_succeeded then p_output end,
        document = case when p_succeeded then coalesce(p_document, p_output) end,
        model = p_model, input_tokens = p_input_tokens, output_tokens = p_output_tokens,
        error = case when p_succeeded then null else left(trim(p_error), 2000) end,
        completed_at = now()
    where id = g.id;
    if p_succeeded then
      insert into public.activity_log (workspace_id, actor_id, entity_type, entity_id, action, metadata)
      values (g.workspace_id, ev.user_id, 'ai_generation', g.id, 'ai.' || g.kind::text || '_generated',
              jsonb_build_object('title', g.title, 'project_id', g.project_id));
    end if;
  elsif p_succeeded and g.status = 'completed' then
    update public.ai_generations
    set document = p_document, edited_by = ev.user_id, edited_at = now()
    where id = g.id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Activity when a generation is deleted
-- -----------------------------------------------------------------------------
create function private.audit_ai_generations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.log_activity(old.workspace_id, 'ai_generation', old.id, 'ai.' || old.kind::text || '_deleted',
    jsonb_build_object('title', old.title, 'project_id', old.project_id));
  return null;
end;
$$;

create trigger ai_generations_audit after delete on public.ai_generations
  for each row execute function private.audit_ai_generations();

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function public.start_ai_generation(uuid, public.ai_generation_kind, text, jsonb, text, uuid, uuid)
  from public, anon;
revoke all on function public.start_ai_revision(uuid) from public, anon;
grant execute on function public.start_ai_generation(uuid, public.ai_generation_kind, text, jsonb, text, uuid, uuid)
  to authenticated;
grant execute on function public.start_ai_revision(uuid) to authenticated;

-- Only the server's secret-key role records results.
revoke all on function public.finish_ai_run(uuid, boolean, text, integer, integer, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.finish_ai_run(uuid, boolean, text, integer, integer, jsonb, jsonb, text)
  to service_role;

revoke all on function private.ai_reserve_run(uuid, uuid) from public;
revoke all on function private.ai_limits() from public;
revoke all on function private.prepare_ai_generation() from public;
revoke all on function private.audit_ai_generations() from public;
