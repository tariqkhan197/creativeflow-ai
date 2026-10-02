-- =============================================================================
-- Phase 2: team, clients, projects & tasks
--
-- Builds on the initial schema (tables and RLS already exist). Adds:
--   * public.get_invitation(token)   — invite landing page lookup
--   * stricter membership rules      — only the owner manages admins
--   * task / project-member rules    — assignees must be staff of the workspace,
--                                      completed_at + position maintained in-DB
--   * activity triggers              — audit trail that application code can't skip
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Membership rules (replaces the Phase 1 trigger function, same trigger)
-- -----------------------------------------------------------------------------
create or replace function private.protect_workspace_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_owner uuid;
  actor uuid := (select auth.uid());
begin
  select owner_id into ws_owner from public.workspaces
  where id = coalesce(new.workspace_id, old.workspace_id);

  if tg_op = 'DELETE' then
    -- ws_owner is null while the whole workspace is being deleted (cascade).
    if ws_owner is not null and old.user_id = ws_owner then
      raise exception 'The workspace owner cannot be removed. Transfer ownership first.';
    end if;
    if ws_owner is not null and old.role = 'admin' and actor is not null
       and actor is distinct from ws_owner and actor is distinct from old.user_id then
      raise exception 'Only the workspace owner can remove an admin.';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id or new.user_id <> old.user_id then
      raise exception 'Membership identity cannot be changed.';
    end if;
    if old.user_id = ws_owner and new.role <> 'owner' then
      raise exception 'The workspace owner role cannot be changed. Transfer ownership first.';
    end if;
    if old.role = 'admin' and new.role <> 'admin' and actor is not null and actor is distinct from ws_owner then
      raise exception 'Only the workspace owner can change an admin''s role.';
    end if;
  end if;

  if new.role = 'owner' and new.user_id is distinct from ws_owner then
    raise exception 'Only the workspace owner can hold the owner role.';
  end if;

  -- Only the owner may grant admin (auth.uid() is null for trusted server code).
  if new.role = 'admin'
     and (tg_op = 'INSERT' or old.role <> 'admin')
     and actor is not null
     and actor is distinct from ws_owner
     and current_setting('creativeflow.trusted_rpc', true) is distinct from 'on' then
    raise exception 'Only the workspace owner can grant the admin role.';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Invitation lookup for the /invite/[token] page. The 256-bit token is the
-- credential: whoever holds the link may see which workspace it is for.
-- -----------------------------------------------------------------------------
create function public.get_invitation(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workspace_name', w.name,
    'email', i.email,
    'role', i.role,
    'inviter_name', coalesce(p.full_name, p.email),
    'expires_at', i.expires_at,
    'status', case
      when i.accepted_at is not null then 'accepted'
      when i.expires_at < now() then 'expired'
      else 'pending'
    end
  )
  from public.workspace_invitations i
  join public.workspaces w on w.id = i.workspace_id
  left join public.profiles p on p.id = i.invited_by
  where char_length(coalesce(p_token, '')) between 20 and 200
    and i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

revoke all on function public.get_invitation(text) from public;
grant execute on function public.get_invitation(text) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Tasks & project members
-- -----------------------------------------------------------------------------
create function private.is_staff_user(ws uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = uid and m.role <> 'client'
  );
$$;

create function private.prepare_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not private.is_staff_user(new.workspace_id, new.assignee_id) then
    raise exception 'The assignee must be a team member of this workspace' using errcode = '23514';
  end if;

  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status <> 'done' then
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;

  -- New tasks, and tasks moved to another column, go to the end of that column.
  if tg_op = 'INSERT' or new.status <> old.status or new.project_id <> old.project_id then
    select coalesce(max(t.position), -1) + 1 into new.position
    from public.tasks t
    where t.project_id = new.project_id and t.status = new.status and t.id <> new.id;
  end if;

  return new;
end;
$$;

create trigger tasks_prepare before insert or update on public.tasks
  for each row execute function private.prepare_task();

create function private.validate_project_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_staff_user(new.workspace_id, new.user_id) then
    raise exception 'Only team members can be assigned to a project' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger project_members_validate before insert or update on public.project_members
  for each row execute function private.validate_project_member();

-- -----------------------------------------------------------------------------
-- Activity log triggers
-- -----------------------------------------------------------------------------
create function private.log_activity(
  ws uuid, p_entity_type text, p_entity_id uuid, p_action text, p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Skip while the workspace itself is being deleted.
  if exists (select 1 from public.workspaces where id = ws) then
    insert into public.activity_log (workspace_id, actor_id, entity_type, entity_id, action, metadata)
    values (ws, (select auth.uid()), p_entity_type, p_entity_id, p_action, p_metadata);
  end if;
end;
$$;

create function private.audit_clients()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.workspace_id, 'client', new.id, 'client.created', jsonb_build_object('name', new.name));
  elsif tg_op = 'DELETE' then
    perform private.log_activity(old.workspace_id, 'client', old.id, 'client.deleted', jsonb_build_object('name', old.name));
  end if;
  return null;
end;
$$;

create trigger clients_audit after insert or delete on public.clients
  for each row execute function private.audit_clients();

create function private.audit_projects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.workspace_id, 'project', new.id, 'project.created', jsonb_build_object('name', new.name));
  elsif tg_op = 'DELETE' then
    perform private.log_activity(old.workspace_id, 'project', old.id, 'project.deleted', jsonb_build_object('name', old.name));
  else
    if new.status <> old.status then
      perform private.log_activity(new.workspace_id, 'project', new.id, 'project.status_changed',
        jsonb_build_object('name', new.name, 'from', old.status, 'to', new.status));
    end if;
    if old.archived_at is null and new.archived_at is not null then
      perform private.log_activity(new.workspace_id, 'project', new.id, 'project.archived', jsonb_build_object('name', new.name));
    elsif old.archived_at is not null and new.archived_at is null then
      perform private.log_activity(new.workspace_id, 'project', new.id, 'project.restored', jsonb_build_object('name', new.name));
    end if;
  end if;
  return null;
end;
$$;

create trigger projects_audit after insert or update or delete on public.projects
  for each row execute function private.audit_projects();

create function private.audit_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.workspace_id, 'task', new.id, 'task.created',
      jsonb_build_object('title', new.title, 'project_id', new.project_id));
  elsif new.status = 'done' and old.status <> 'done' then
    perform private.log_activity(new.workspace_id, 'task', new.id, 'task.completed',
      jsonb_build_object('title', new.title, 'project_id', new.project_id));
  end if;
  return null;
end;
$$;

create trigger tasks_audit after insert or update of status on public.tasks
  for each row execute function private.audit_tasks();

create function private.audit_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.workspace_id, 'invitation', new.id, 'invitation.created',
      jsonb_build_object('email', new.email, 'role', new.role));
  elsif old.accepted_at is null then
    perform private.log_activity(old.workspace_id, 'invitation', old.id, 'invitation.revoked',
      jsonb_build_object('email', old.email));
  end if;
  return null;
end;
$$;

create trigger invitations_audit after insert or delete on public.workspace_invitations
  for each row execute function private.audit_invitations();

create function private.audit_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.role <> old.role then
      perform private.log_activity(new.workspace_id, 'member', new.user_id, 'member.role_changed',
        jsonb_build_object('from', old.role, 'to', new.role));
    end if;
  elsif tg_op = 'DELETE' then
    perform private.log_activity(old.workspace_id, 'member', old.user_id,
      case when old.user_id = (select auth.uid()) then 'member.left' else 'member.removed' end,
      '{}'::jsonb);
  end if;
  return null;
end;
$$;

create trigger workspace_members_audit after update or delete on public.workspace_members
  for each row execute function private.audit_members();

-- Trigger/helper functions are internal only.
revoke all on function private.is_staff_user(uuid, uuid) from public;
revoke all on function private.prepare_task() from public;
revoke all on function private.validate_project_member() from public;
revoke all on function private.log_activity(uuid, text, uuid, text, jsonb) from public;
revoke all on function private.audit_clients() from public;
revoke all on function private.audit_projects() from public;
revoke all on function private.audit_tasks() from public;
revoke all on function private.audit_invitations() from public;
revoke all on function private.audit_members() from public;
