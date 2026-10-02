-- =============================================================================
-- Phase 4: client portal & approvals
--
-- Fixes the gaps found while planning (G1–G5) and adds what the approved
-- decisions (D1–D8) need. Policies only become stricter for client users;
-- staff behaviour is unchanged except that approvals must now follow the
-- rules below.
--
--   G1  Clients no longer read public.projects / public.clients directly
--       (that exposed budget, internal brief and the agency's private notes).
--       They use portal_projects() / portal_project(), which return safe
--       columns only.
--   G2  An approval targets a ready, shared version in the same project of a
--       portal-visible project; a client may only decide what they can see.
--   G3  At most one pending approval per version.
--   G4  Revision round numbers are allocated under a project row lock.
--   G5  Project status follows approval events (D7).
--   D1  projects.client_summary: optional client-facing description.
--   D2  Managers may invite/revoke client-role invitations and remove
--       client-role members (team invites stay admin-only).
--   D4  request_approval() shares the version and requests approval atomically.
--   D5  In-app notification to the client's portal users on approval request.
--   D6  projects.allow_client_downloads (default true).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- New project columns (D1, D6)
-- -----------------------------------------------------------------------------
alter table public.projects
  add column client_summary text check (char_length(client_summary) <= 2000),
  add column allow_client_downloads boolean not null default true;

-- -----------------------------------------------------------------------------
-- G1: clients read projects/clients only through safe functions
-- -----------------------------------------------------------------------------
drop policy "projects: staff or bound client read" on public.projects;
create policy "projects: staff read" on public.projects
  for select to authenticated using (private.is_staff(workspace_id));

drop policy "clients: staff read, client reads own" on public.clients;
create policy "clients: staff read" on public.clients
  for select to authenticated using (private.is_staff(workspace_id));

-- Projects visible to the calling client user in one workspace, safe columns only.
create function public.portal_projects(p_workspace uuid)
returns table (
  id uuid,
  name text,
  status public.project_status,
  start_date date,
  due_date date,
  client_summary text,
  client_name text,
  allow_client_downloads boolean,
  pending_approvals integer,
  shared_files integer,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, p.name, p.status, p.start_date, p.due_date, p.client_summary,
    coalesce(c.company, c.name), p.allow_client_downloads,
    (select count(*)::int from public.approvals ap
      where ap.project_id = p.id and ap.status = 'pending'),
    (select count(distinct coalesce(a.root_asset_id, a.id))::int from public.assets a
      where a.project_id = p.id and a.shared_with_client and a.status = 'ready'),
    p.updated_at
  from public.projects p
  join public.clients c on c.id = p.client_id
  where p.workspace_id = p_workspace
    and private.client_can_view_project(p.id)
  order by p.updated_at desc;
$$;

create function public.portal_project(p_project uuid)
returns table (
  id uuid,
  workspace_id uuid,
  name text,
  status public.project_status,
  start_date date,
  due_date date,
  client_summary text,
  client_name text,
  allow_client_downloads boolean,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.workspace_id, p.name, p.status, p.start_date, p.due_date, p.client_summary,
         coalesce(c.company, c.name), p.allow_client_downloads, p.updated_at
  from public.projects p
  join public.clients c on c.id = p.client_id
  where p.id = p_project
    and private.client_can_view_project(p.id);
$$;

revoke all on function public.portal_projects(uuid) from public, anon;
revoke all on function public.portal_project(uuid) from public, anon;
grant execute on function public.portal_projects(uuid) to authenticated, service_role;
grant execute on function public.portal_project(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- G2: clients only read approvals for versions they can see
-- -----------------------------------------------------------------------------
drop policy "approvals: read" on public.approvals;
create policy "approvals: read" on public.approvals
  for select to authenticated
  using (
    private.is_staff(workspace_id)
    or (
      private.client_can_view_project(project_id)
      and asset_id is not null
      and private.can_view_asset(asset_id)
    )
  );

-- G3: one pending approval per version.
create unique index approvals_one_pending_per_asset on public.approvals (asset_id) where status = 'pending';
create index approvals_workspace_status_idx on public.approvals (workspace_id, status, created_at desc);

-- -----------------------------------------------------------------------------
-- Approval rules (G2, G3, G5)
--
-- Decisions are written only by decide_approval(). That function is SECURITY
-- DEFINER, so inside it (and in the invoker-rights trigger it fires) the
-- current role is the function owner. Direct Data API writes always run as
-- `anon` or `authenticated`. Unlike a session setting, the current role can't
-- be changed by an API caller.
-- -----------------------------------------------------------------------------
create function private.in_approval_workflow()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user not in ('anon', 'authenticated');
$$;

-- Security invoker on purpose: see private.in_approval_workflow().
create function private.prepare_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  a public.assets%rowtype;
  pr public.projects%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'New approvals must be pending' using errcode = '23514';
    end if;
    if new.asset_id is null then
      raise exception 'Choose the version to be approved' using errcode = '23514';
    end if;
    select * into a from public.assets where id = new.asset_id;
    select * into pr from public.projects where id = new.project_id;
    if a.project_id is distinct from new.project_id then
      raise exception 'The version must belong to this project' using errcode = '23514';
    end if;
    if a.status <> 'ready' then
      raise exception 'Only uploaded files can be sent for approval' using errcode = '23514';
    end if;
    if pr.client_id is null or not pr.client_visible or pr.archived_at is not null then
      raise exception 'Show the project in the client portal before requesting approval' using errcode = '23514';
    end if;
    if not a.shared_with_client then
      raise exception 'Share this version with the client before requesting approval' using errcode = '23514';
    end if;
    new.decided_by := null;
    new.decided_at := null;
    new.decision_note := null;
    return new;
  end if;

  -- UPDATE. A user reference may only become null through its foreign key
  -- (ON DELETE SET NULL after the user was deleted).
  if new.requested_by is null and old.requested_by is not null
     and not exists (select 1 from auth.users where id = old.requested_by) then
    old.requested_by := null;
  end if;
  if new.decided_by is null and old.decided_by is not null
     and not exists (select 1 from auth.users where id = old.decided_by) then
    old.decided_by := null;
  end if;
  if new.workspace_id <> old.workspace_id or new.project_id <> old.project_id
     or new.asset_id is distinct from old.asset_id or new.requested_by is distinct from old.requested_by then
    raise exception 'An approval''s project, version and requester cannot be changed' using errcode = '23514';
  end if;
  if old.status <> 'pending' and (new.status <> old.status or new.decision_note is distinct from old.decision_note) then
    raise exception 'This approval has already been closed' using errcode = '23514';
  end if;
  if new.status in ('approved', 'changes_requested') and new.status <> old.status and not private.in_approval_workflow() then
    raise exception 'Approvals are decided through the approval workflow' using errcode = '42501';
  end if;
  if not private.in_approval_workflow()
     and (new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at
          or new.decision_note is distinct from old.decision_note) then
    raise exception 'Decision details are recorded by the approval workflow' using errcode = '42501';
  end if;
  if new.status = 'cancelled' and old.status = 'pending' then
    new.decided_by := (select auth.uid());
    new.decided_at := now();
  end if;
  return new;
end;
$$;

create trigger approvals_prepare before insert or update on public.approvals
  for each row execute function private.prepare_approval();

-- On request: move the project into review (D7), notify the client's portal
-- users (D5), and log it. On cancel: log it.
create function private.after_approval_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.projects%rowtype;
begin
  select * into pr from public.projects where id = new.project_id;

  if tg_op = 'INSERT' then
    if pr.status in ('planning', 'in_progress', 'revisions', 'approved') then
      update public.projects set status = 'in_review' where id = pr.id;
    end if;

    insert into public.notifications (workspace_id, user_id, type, title, body, link, actor_id)
    select new.workspace_id, m.user_id, 'approval.requested', 'Approval requested: ' || new.title,
           nullif(left(coalesce(new.message, ''), 2000), ''),
           '/portal/projects/' || new.project_id::text || '/files/' || new.asset_id::text,
           new.requested_by
    from public.workspace_members m
    where m.workspace_id = new.workspace_id and m.role = 'client' and m.client_id = pr.client_id;

    perform private.log_activity(new.workspace_id, 'approval', new.id, 'approval.requested',
      jsonb_build_object('title', new.title, 'project_id', new.project_id, 'asset_id', new.asset_id));
  elsif new.status = 'cancelled' and old.status = 'pending' then
    perform private.log_activity(new.workspace_id, 'approval', new.id, 'approval.cancelled',
      jsonb_build_object('title', new.title, 'project_id', new.project_id, 'asset_id', new.asset_id));
  end if;
  return null;
end;
$$;

create trigger approvals_after_change after insert or update of status on public.approvals
  for each row execute function private.after_approval_change();

-- A version (or project) with a pending approval can't be hidden from the client.
create function private.guard_pending_approval_visibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'assets' then
    if old.shared_with_client and not new.shared_with_client
       and exists (select 1 from public.approvals where asset_id = new.id and status = 'pending') then
      raise exception 'Cancel the pending approval before unsharing this version' using errcode = '23514';
    end if;
  else
    if (old.client_visible and not new.client_visible)
       or (new.client_id is distinct from old.client_id)
       or (old.archived_at is null and new.archived_at is not null) then
      if exists (select 1 from public.approvals where project_id = new.id and status = 'pending') then
        raise exception 'Cancel the pending approvals before hiding this project from the client' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger assets_guard_pending_approval before update of shared_with_client on public.assets
  for each row execute function private.guard_pending_approval_visibility();
create trigger projects_guard_pending_approval before update of client_visible, client_id, archived_at on public.projects
  for each row execute function private.guard_pending_approval_visibility();

-- -----------------------------------------------------------------------------
-- D4: share + request in one step (runs with the caller's privileges/RLS)
-- -----------------------------------------------------------------------------
create function public.request_approval(
  p_asset uuid,
  p_title text,
  p_message text default null,
  p_due_date date default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  a public.assets%rowtype;
  approval_id uuid;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into a from public.assets where id = p_asset;
  if not found or not private.is_staff(a.workspace_id) then
    raise exception 'File not found' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_title, ''))) = 0 then
    raise exception 'Give the approval a title' using errcode = '22023';
  end if;
  if p_due_date is not null and p_due_date < current_date then
    raise exception 'The due date can''t be in the past' using errcode = '22023';
  end if;

  if not a.shared_with_client then
    update public.assets set shared_with_client = true where id = a.id;
  end if;

  insert into public.approvals (workspace_id, project_id, asset_id, title, message, requested_by, due_date)
  values (a.workspace_id, a.project_id, a.id, trim(p_title), nullif(trim(coalesce(p_message, '')), ''), uid, p_due_date)
  returning id into approval_id;
  return approval_id;
exception
  when unique_violation then
    raise exception 'This version already has a pending approval' using errcode = '23505';
end;
$$;

revoke all on function public.request_approval(uuid, text, text, date) from public, anon;
grant execute on function public.request_approval(uuid, text, text, date) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- decide_approval (replaces Phase 1): G2 visibility, G4 lock, G5 automation
-- -----------------------------------------------------------------------------
create or replace function public.decide_approval(p_approval uuid, p_decision public.approval_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ap public.approvals%rowtype;
  may_decide boolean;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_decision not in ('approved', 'changes_requested') then
    raise exception 'Decision must be approved or changes_requested' using errcode = '22023';
  end if;
  if p_decision = 'changes_requested' and char_length(coalesce(trim(p_note), '')) = 0 then
    raise exception 'Please describe the requested changes' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 5000 then
    raise exception 'The note is too long' using errcode = '22023';
  end if;

  select * into ap from public.approvals where id = p_approval for update;
  if not found then
    raise exception 'Approval not found' using errcode = '42501';
  end if;
  may_decide := private.can_manage(ap.workspace_id)
    or (private.client_can_view_project(ap.project_id) and ap.asset_id is not null and private.can_view_asset(ap.asset_id));
  if not may_decide then
    raise exception 'Approval not found' using errcode = '42501';
  end if;
  if ap.status <> 'pending' then
    raise exception 'This approval has already been decided' using errcode = '22023';
  end if;

  -- G4: serialize decisions per project so revision numbers never collide.
  perform 1 from public.projects where id = ap.project_id for update;

  update public.approvals
  set status = p_decision, decided_by = uid, decided_at = now(), decision_note = nullif(trim(p_note), '')
  where id = ap.id;

  if p_decision = 'changes_requested' then
    -- round_number is allocated by revisions_prepare under the project lock.
    insert into public.revisions (workspace_id, project_id, approval_id, asset_id, round_number, summary, requested_by)
    values (ap.workspace_id, ap.project_id, ap.id, ap.asset_id, 1, trim(p_note), uid);

    update public.projects set status = 'revisions'
    where id = ap.project_id and status not in ('delivered', 'cancelled');
  else
    -- D7: approved once nothing else is waiting on the client or the team.
    update public.projects set status = 'approved'
    where id = ap.project_id
      and status not in ('delivered', 'cancelled', 'on_hold')
      and not exists (select 1 from public.approvals x where x.project_id = ap.project_id and x.status = 'pending')
      and not exists (select 1 from public.revisions r where r.project_id = ap.project_id and r.status <> 'completed');
  end if;

  if ap.requested_by is not null and ap.requested_by <> uid then
    insert into public.notifications (workspace_id, user_id, type, title, body, link, actor_id)
    values (
      ap.workspace_id, ap.requested_by,
      case when p_decision = 'approved' then 'approval.approved' else 'approval.changes_requested' end,
      case when p_decision = 'approved' then 'Approved: ' else 'Changes requested: ' end || ap.title,
      nullif(trim(p_note), ''),
      '/app/projects/' || ap.project_id::text || '/assets/' || ap.asset_id::text,
      uid
    );
  end if;

  insert into public.activity_log (workspace_id, actor_id, entity_type, entity_id, action, metadata)
  values (ap.workspace_id, uid, 'approval', ap.id, 'approval.' || p_decision::text,
          jsonb_build_object('title', ap.title, 'project_id', ap.project_id, 'asset_id', ap.asset_id));
end;
$$;

-- -----------------------------------------------------------------------------
-- Revision rounds: completion timestamp and activity
-- -----------------------------------------------------------------------------
create function private.prepare_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- G4: number rounds under a project row lock, whoever inserts them.
    perform 1 from public.projects where id = new.project_id for update;
    select coalesce(max(round_number), 0) + 1 into new.round_number
    from public.revisions where project_id = new.project_id;
    if new.approval_id is not null
       and not exists (select 1 from public.approvals where id = new.approval_id and project_id = new.project_id) then
      raise exception 'The approval must belong to this project' using errcode = '23514';
    end if;
    if new.asset_id is not null
       and not exists (select 1 from public.assets where id = new.asset_id and project_id = new.project_id) then
      raise exception 'The file must belong to this project' using errcode = '23514';
    end if;
  else
    -- References may only become null through their foreign keys (deleted
    -- approval, file or user).
    if new.approval_id is null and old.approval_id is not null
       and not exists (select 1 from public.approvals where id = old.approval_id) then
      old.approval_id := null;
    end if;
    if new.requested_by is null and old.requested_by is not null
       and not exists (select 1 from auth.users where id = old.requested_by) then
      old.requested_by := null;
    end if;
    if new.project_id <> old.project_id or new.workspace_id <> old.workspace_id
       or new.round_number <> old.round_number or new.approval_id is distinct from old.approval_id
       or new.requested_by is distinct from old.requested_by or new.summary <> old.summary then
      raise exception 'Only a revision round''s status can be changed' using errcode = '23514';
    end if;
  end if;
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status <> 'completed' then
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger revisions_prepare before insert or update on public.revisions
  for each row execute function private.prepare_revision();

create function private.audit_revisions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.workspace_id, 'revision', new.id, 'revision.opened',
      jsonb_build_object('round', new.round_number, 'project_id', new.project_id));
  elsif new.status <> old.status then
    perform private.log_activity(new.workspace_id, 'revision', new.id, 'revision.' || new.status::text,
      jsonb_build_object('round', new.round_number, 'project_id', new.project_id));
  end if;
  return null;
end;
$$;

create trigger revisions_audit after insert or update of status on public.revisions
  for each row execute function private.audit_revisions();

-- -----------------------------------------------------------------------------
-- D2: managers manage client portal access (client-role invitations/members)
-- -----------------------------------------------------------------------------
create policy "invitations: managers read client invites" on public.workspace_invitations
  for select to authenticated using (role = 'client' and private.can_manage(workspace_id));
create policy "invitations: managers create client invites" on public.workspace_invitations
  for insert to authenticated
  with check (role = 'client' and private.can_manage(workspace_id) and invited_by = (select auth.uid()));
create policy "invitations: managers revoke client invites" on public.workspace_invitations
  for delete to authenticated using (role = 'client' and private.can_manage(workspace_id));

create policy "members: managers remove client access" on public.workspace_members
  for delete to authenticated using (role = 'client' and private.can_manage(workspace_id));

-- -----------------------------------------------------------------------------
-- Internal helpers are not callable directly.
-- -----------------------------------------------------------------------------
revoke all on function private.prepare_approval() from public;
revoke all on function private.after_approval_change() from public;
revoke all on function private.guard_pending_approval_visibility() from public;
revoke all on function private.prepare_revision() from public;
revoke all on function private.audit_revisions() from public;
grant execute on function private.in_approval_workflow() to authenticated;
