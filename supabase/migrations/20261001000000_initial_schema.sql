-- =============================================================================
-- CreativeFlow AI — initial schema
--
-- Multi-tenant model: every tenant-owned row carries `workspace_id`. Row Level
-- Security (RLS) is enabled on every table and all access decisions are made by
-- the SECURITY DEFINER helpers in the `private` schema (which is NOT exposed
-- through the Supabase Data API). Child rows reference their parent through a
-- composite (id, workspace_id) foreign key, so a row can never point at a
-- parent that belongs to a different workspace.
-- =============================================================================

create schema if not exists private;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.workspace_role as enum ('owner', 'admin', 'manager', 'member', 'client');
create type public.project_status as enum (
  'planning', 'in_progress', 'in_review', 'revisions', 'approved', 'delivered', 'on_hold', 'cancelled'
);
create type public.project_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.task_status as enum ('todo', 'in_progress', 'review', 'done');
create type public.asset_kind as enum ('video', 'image', 'audio', 'document', 'other');
create type public.asset_status as enum ('uploading', 'ready', 'failed');
create type public.approval_status as enum ('pending', 'approved', 'changes_requested', 'cancelled');
create type public.revision_status as enum ('open', 'in_progress', 'completed');
create type public.ai_generation_kind as enum ('script', 'storyboard');
create type public.ai_generation_status as enum ('pending', 'completed', 'failed');
create type public.invoice_status as enum ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'refunded');

-- -----------------------------------------------------------------------------
-- Generic trigger: maintain updated_at
-- -----------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text check (char_length(full_name) <= 120),
  avatar_url text,
  job_title text check (char_length(job_title) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- Create a profile whenever a new auth user signs up.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120), ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Keep profile email in sync when the user changes it.
create function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function private.handle_user_email_change();

-- -----------------------------------------------------------------------------
-- Workspaces (tenants) & membership
-- -----------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  owner_id uuid not null references auth.users (id) on delete restrict,
  logo_url text,
  default_currency char(3) not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function private.set_updated_at();

-- Ownership can only change through a dedicated, audited flow (not a plain UPDATE).
create function private.protect_workspace_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id
     and current_setting('creativeflow.trusted_rpc', true) is distinct from 'on' then
    raise exception 'Workspace ownership cannot be changed directly.';
  end if;
  return new;
end;
$$;

create trigger workspaces_protect_owner before update on public.workspaces
  for each row execute function private.protect_workspace_owner();

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  company text check (char_length(company) <= 120),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (char_length(phone) <= 40),
  notes text check (char_length(notes) <= 5000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index clients_workspace_idx on public.clients (workspace_id);
create trigger clients_updated_at before update on public.clients
  for each row execute function private.set_updated_at();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null default 'member',
  -- Client-portal users are bound to exactly one client record.
  client_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  foreign key (client_id, workspace_id) references public.clients (id, workspace_id) on delete cascade,
  check ((role = 'client') = (client_id is not null))
);

create index workspace_members_user_idx on public.workspace_members (user_id);
create trigger workspace_members_updated_at before update on public.workspace_members
  for each row execute function private.set_updated_at();

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.workspace_role not null check (role <> 'owner'),
  client_id uuid,
  -- SHA-256 hex digest of the invitation token. The raw token is only ever
  -- sent to the invitee and is never stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (client_id, workspace_id) references public.clients (id, workspace_id) on delete cascade,
  check ((role = 'client') = (client_id is not null))
);

create index workspace_invitations_workspace_idx on public.workspace_invitations (workspace_id);
create unique index workspace_invitations_pending_email_idx
  on public.workspace_invitations (workspace_id, lower(email)) where accepted_at is null;

-- Per-workspace counters (e.g. sequential invoice numbers).
create table public.workspace_counters (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  invoice_seq integer not null default 0
);

-- -----------------------------------------------------------------------------
-- Access helpers (SECURITY DEFINER, private schema, never exposed via the API)
-- -----------------------------------------------------------------------------
create function private.has_role(ws uuid, roles public.workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
  );
$$;

create function private.is_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  );
$$;

-- Internal agency staff (everyone except client-portal users).
create function private.is_staff(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(ws, array['owner', 'admin', 'manager', 'member']::public.workspace_role[]);
$$;

create function private.can_manage(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(ws, array['owner', 'admin', 'manager']::public.workspace_role[]);
$$;

create function private.is_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(ws, array['owner', 'admin']::public.workspace_role[]);
$$;

-- The client record a client-portal user is bound to (null for staff).
create function private.member_client_id(ws uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.client_id from public.workspace_members m
  where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role = 'client';
$$;

create function private.is_workspace_user(ws uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = uid
  );
$$;

create function private.shares_workspace(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = other
      -- client users can only see staff profiles, never other clients
      and (mine.role <> 'client' or theirs.role <> 'client' or theirs.user_id = mine.user_id)
  );
$$;

-- -----------------------------------------------------------------------------
-- Projects & tasks
-- -----------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  client_id uuid,
  name text not null check (char_length(name) between 2 and 140),
  description text check (char_length(description) <= 10000),
  status public.project_status not null default 'planning',
  priority public.project_priority not null default 'medium',
  start_date date,
  due_date date,
  budget_cents bigint check (budget_cents is null or budget_cents >= 0),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  -- When true, client-portal users bound to `client_id` may view this project.
  client_visible boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (client_id, workspace_id) references public.clients (id, workspace_id) on delete set null (client_id),
  check (due_date is null or start_date is null or due_date >= start_date)
);

create index projects_workspace_idx on public.projects (workspace_id, status);
create index projects_client_idx on public.projects (client_id);
create trigger projects_updated_at before update on public.projects
  for each row execute function private.set_updated_at();

create function private.client_can_view_project(p uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects pr
    join public.workspace_members m
      on m.workspace_id = pr.workspace_id and m.user_id = (select auth.uid())
    where pr.id = p
      and m.role = 'client'
      and pr.client_visible
      and pr.archived_at is null
      and pr.client_id = m.client_id
  );
$$;

create function private.can_view_project(p uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects pr where pr.id = p and private.is_staff(pr.workspace_id)
  ) or private.client_can_view_project(p);
$$;

create table public.project_members (
  project_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id) references public.workspace_members (workspace_id, user_id) on delete cascade
);

create index project_members_user_idx on public.project_members (user_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 5000),
  status public.task_status not null default 'todo',
  assignee_id uuid references auth.users (id) on delete set null,
  due_date date,
  position integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);

create index tasks_project_idx on public.tasks (project_id, status, position);
create index tasks_assignee_idx on public.tasks (assignee_id) where assignee_id is not null;
create trigger tasks_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Assets (files in Supabase Storage) & timestamped review comments
-- -----------------------------------------------------------------------------
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  name text not null check (char_length(name) between 1 and 255),
  kind public.asset_kind not null,
  status public.asset_status not null default 'uploading',
  -- Object key inside the `project-assets` bucket:
  -- {workspace_id}/{project_id}/{asset_id}/{file name}
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  duration_seconds numeric(10, 3) check (duration_seconds is null or duration_seconds >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  version_number integer not null default 1 check (version_number >= 1),
  -- First version of this asset; null for the original upload.
  root_asset_id uuid references public.assets (id) on delete cascade,
  shared_with_client boolean not null default false,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade,
  check (storage_path like workspace_id::text || '/' || project_id::text || '/%')
);

create index assets_project_idx on public.assets (project_id, created_at desc);
create index assets_root_idx on public.assets (root_asset_id) where root_asset_id is not null;
create trigger assets_updated_at before update on public.assets
  for each row execute function private.set_updated_at();

create function private.can_view_asset(a uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assets x
    where x.id = a
      and (
        private.is_staff(x.workspace_id)
        or (x.shared_with_client and x.status = 'ready' and private.client_can_view_project(x.project_id))
      )
  );
$$;

create table public.review_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  asset_id uuid not null,
  parent_id uuid references public.review_comments (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(body) between 1 and 5000),
  -- Playback position in seconds the comment refers to (null = general comment).
  timestamp_seconds numeric(10, 3) check (timestamp_seconds is null or timestamp_seconds >= 0),
  -- Optional annotation: {x, y} as fractions of the frame (0..1).
  annotation jsonb,
  -- Internal notes are hidden from client-portal users.
  is_internal boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (asset_id, workspace_id) references public.assets (id, workspace_id) on delete cascade
);

create index review_comments_asset_idx on public.review_comments (asset_id, timestamp_seconds);
create trigger review_comments_updated_at before update on public.review_comments
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Approvals & revisions
-- -----------------------------------------------------------------------------
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  asset_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  message text check (char_length(message) <= 5000),
  status public.approval_status not null default 'pending',
  requested_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 5000),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade,
  foreign key (asset_id, workspace_id) references public.assets (id, workspace_id) on delete cascade
);

create index approvals_project_idx on public.approvals (project_id, status);
create trigger approvals_updated_at before update on public.approvals
  for each row execute function private.set_updated_at();

create table public.revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  approval_id uuid,
  asset_id uuid,
  round_number integer not null check (round_number >= 1),
  summary text not null check (char_length(summary) between 1 and 5000),
  status public.revision_status not null default 'open',
  requested_by uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade,
  foreign key (approval_id, workspace_id) references public.approvals (id, workspace_id) on delete set null (approval_id),
  foreign key (asset_id, workspace_id) references public.assets (id, workspace_id) on delete set null (asset_id),
  unique (project_id, round_number)
);

create trigger revisions_updated_at before update on public.revisions
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- AI generations (scripts & storyboards)
-- -----------------------------------------------------------------------------
create table public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid,
  kind public.ai_generation_kind not null,
  title text check (char_length(title) <= 200),
  prompt text not null check (char_length(prompt) between 1 and 20000),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  model text,
  status public.ai_generation_status not null default 'pending',
  input_tokens integer,
  output_tokens integer,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete set null (project_id)
);

create index ai_generations_workspace_idx on public.ai_generations (workspace_id, created_at desc);
create trigger ai_generations_updated_at before update on public.ai_generations
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Invoices, line items & payments
-- -----------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  client_id uuid not null,
  project_id uuid,
  number text not null,
  status public.invoice_status not null default 'draft',
  issue_date date not null default current_date,
  due_date date,
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  tax_rate_bps integer not null default 0 check (tax_rate_bps between 0 and 10000),
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  amount_paid_cents bigint not null default 0 check (amount_paid_cents >= 0),
  notes text check (char_length(notes) <= 5000),
  stripe_checkout_session_id text unique,
  sent_at timestamptz,
  paid_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, number),
  foreign key (client_id, workspace_id) references public.clients (id, workspace_id) on delete restrict,
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete set null (project_id),
  check (due_date is null or due_date >= issue_date)
);

create index invoices_workspace_idx on public.invoices (workspace_id, status);
create index invoices_client_idx on public.invoices (client_id);
create trigger invoices_updated_at before update on public.invoices
  for each row execute function private.set_updated_at();

-- Assign a sequential, per-workspace invoice number (INV-000001, ...).
create function private.assign_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_seq integer;
begin
  if new.number is null or new.number = '' then
    insert into public.workspace_counters (workspace_id, invoice_seq)
    values (new.workspace_id, 1)
    on conflict (workspace_id)
      do update set invoice_seq = public.workspace_counters.invoice_seq + 1
    returning invoice_seq into next_seq;
    new.number := 'INV-' || lpad(next_seq::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger invoices_assign_number before insert on public.invoices
  for each row execute function private.assign_invoice_number();

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  invoice_id uuid not null,
  description text not null check (char_length(description) between 1 and 500),
  quantity numeric(12, 2) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  amount_cents bigint generated always as (round(quantity * unit_price_cents)::bigint) stored,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (invoice_id, workspace_id) references public.invoices (id, workspace_id) on delete cascade
);

create index invoice_items_invoice_idx on public.invoice_items (invoice_id, position);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  invoice_id uuid not null,
  provider text not null default 'stripe' check (provider in ('stripe', 'manual')),
  provider_payment_id text,
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status public.payment_status not null,
  paid_at timestamptz,
  raw_event jsonb,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (invoice_id, workspace_id) references public.invoices (id, workspace_id) on delete restrict,
  unique (provider, provider_payment_id)
);

create index payments_invoice_idx on public.payments (invoice_id);
create index payments_workspace_idx on public.payments (workspace_id, created_at desc);

-- Recalculate invoice totals from line items and settled payments.
create function private.recalculate_invoice(inv uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subtotal bigint;
  v_paid bigint;
  v_rate integer;
  v_tax bigint;
  v_total bigint;
  v_status public.invoice_status;
begin
  select coalesce(sum(amount_cents), 0) into v_subtotal
  from public.invoice_items where invoice_id = inv;

  select coalesce(sum(amount_cents) filter (where status = 'succeeded'), 0)
       - coalesce(sum(amount_cents) filter (where status = 'refunded'), 0)
    into v_paid
  from public.payments where invoice_id = inv;

  select tax_rate_bps, status into v_rate, v_status from public.invoices where id = inv;
  if not found then
    return;
  end if;

  v_tax := round(v_subtotal * v_rate / 10000.0)::bigint;
  v_total := v_subtotal + v_tax;
  v_paid := greatest(v_paid, 0);

  update public.invoices
  set subtotal_cents = v_subtotal,
      tax_cents = v_tax,
      total_cents = v_total,
      amount_paid_cents = v_paid,
      status = case
        when v_status in ('draft', 'void') then v_status
        when v_total > 0 and v_paid >= v_total then 'paid'::public.invoice_status
        when v_paid > 0 then 'partially_paid'::public.invoice_status
        when v_status in ('paid', 'partially_paid') then 'sent'::public.invoice_status
        else v_status
      end,
      paid_at = case when v_total > 0 and v_paid >= v_total then coalesce(paid_at, now()) else null end
  where id = inv;
end;
$$;

create function private.invoice_items_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recalculate_invoice(coalesce(new.invoice_id, old.invoice_id));
  return null;
end;
$$;

create trigger invoice_items_recalculate after insert or update or delete on public.invoice_items
  for each row execute function private.invoice_items_changed();

create trigger payments_recalculate after insert or update or delete on public.payments
  for each row execute function private.invoice_items_changed();

create function private.invoice_tax_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tax_rate_bps is distinct from old.tax_rate_bps then
    perform private.recalculate_invoice(new.id);
  end if;
  return null;
end;
$$;

create trigger invoices_tax_recalculate after update of tax_rate_bps on public.invoices
  for each row execute function private.invoice_tax_changed();

-- -----------------------------------------------------------------------------
-- Notifications & activity log
-- -----------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type ~ '^[a-z_.]{2,64}$'),
  title text not null check (char_length(title) between 1 and 200),
  body text check (char_length(body) <= 2000),
  link text check (link is null or link ~ '^/'),
  actor_id uuid references auth.users (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

create table public.activity_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  entity_type text not null check (entity_type ~ '^[a-z_]{2,40}$'),
  entity_id uuid,
  action text not null check (action ~ '^[a-z_.]{2,64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index activity_log_workspace_idx on public.activity_log (workspace_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Membership integrity: the owner row is protected, roles can't be escalated
-- to owner, and only owners can mint new admins.
-- -----------------------------------------------------------------------------
create function private.protect_workspace_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_owner uuid;
begin
  select owner_id into ws_owner from public.workspaces
  where id = coalesce(new.workspace_id, old.workspace_id);

  if tg_op = 'DELETE' then
    -- Allow cascades when the whole workspace is being deleted.
    if old.user_id = ws_owner and exists (select 1 from public.workspaces where id = old.workspace_id) then
      raise exception 'The workspace owner cannot be removed. Transfer ownership first.';
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
  end if;

  if new.role = 'owner' and new.user_id is distinct from ws_owner then
    raise exception 'Only the workspace owner can hold the owner role.';
  end if;

  -- Only the owner may grant admin (auth.uid() is null for trusted server code).
  if new.role = 'admin'
     and (tg_op = 'INSERT' or old.role <> 'admin')
     and (select auth.uid()) is not null
     and (select auth.uid()) is distinct from ws_owner
     and current_setting('creativeflow.trusted_rpc', true) is distinct from 'on' then
    raise exception 'Only the workspace owner can grant the admin role.';
  end if;

  return new;
end;
$$;

create trigger workspace_members_protect before insert or update or delete on public.workspace_members
  for each row execute function private.protect_workspace_members();

-- -----------------------------------------------------------------------------
-- RPCs callable by signed-in users
-- -----------------------------------------------------------------------------

-- Create a workspace and make the caller its owner (atomic).
create function public.create_workspace(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ws uuid;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if char_length(trim(p_name)) < 2 or char_length(trim(p_name)) > 80 then
    raise exception 'Workspace name must be between 2 and 80 characters' using errcode = '22023';
  end if;
  if (select count(*) from public.workspaces where owner_id = uid) >= 10 then
    raise exception 'Workspace limit reached' using errcode = '54000';
  end if;

  insert into public.workspaces (name, slug, owner_id)
  values (trim(p_name), lower(trim(p_slug)), uid)
  returning id into ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, uid, 'owner');

  insert into public.workspace_counters (workspace_id) values (ws);

  insert into public.activity_log (workspace_id, actor_id, entity_type, entity_id, action)
  values (ws, uid, 'workspace', ws, 'workspace.created');

  return ws;
end;
$$;

-- Accept an invitation using the raw token from the invite link.
create function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  user_email text;
  inv public.workspace_invitations%rowtype;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select email into user_email from auth.users where id = uid;

  select * into inv from public.workspace_invitations
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  for update;

  if not found or inv.accepted_at is not null or inv.expires_at < now() then
    raise exception 'This invitation is invalid or has expired' using errcode = '22023';
  end if;
  if lower(inv.email) <> lower(coalesce(user_email, '')) then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;

  perform set_config('creativeflow.trusted_rpc', 'on', true);

  insert into public.workspace_members (workspace_id, user_id, role, client_id)
  values (inv.workspace_id, uid, inv.role, inv.client_id)
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations
  set accepted_at = now(), accepted_by = uid
  where id = inv.id;

  insert into public.activity_log (workspace_id, actor_id, entity_type, entity_id, action, metadata)
  values (inv.workspace_id, uid, 'member', uid, 'member.joined', jsonb_build_object('role', inv.role));

  perform set_config('creativeflow.trusted_rpc', 'off', true);
  return inv.workspace_id;
end;
$$;

-- Approve or request changes on an approval (staff or the bound client).
create function public.decide_approval(p_approval uuid, p_decision public.approval_status, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ap public.approvals%rowtype;
  next_round integer;
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

  select * into ap from public.approvals where id = p_approval for update;
  if not found or not (private.can_manage(ap.workspace_id) or private.client_can_view_project(ap.project_id)) then
    raise exception 'Approval not found' using errcode = '42501';
  end if;
  if ap.status <> 'pending' then
    raise exception 'This approval has already been decided' using errcode = '22023';
  end if;

  update public.approvals
  set status = p_decision, decided_by = uid, decided_at = now(), decision_note = nullif(trim(p_note), '')
  where id = ap.id;

  if p_decision = 'changes_requested' then
    select coalesce(max(round_number), 0) + 1 into next_round
    from public.revisions where project_id = ap.project_id;

    insert into public.revisions (workspace_id, project_id, approval_id, asset_id, round_number, summary, requested_by)
    values (ap.workspace_id, ap.project_id, ap.id, ap.asset_id, next_round, trim(p_note), uid);

    update public.projects set status = 'revisions' where id = ap.project_id;
  end if;

  if ap.requested_by is not null and ap.requested_by <> uid then
    insert into public.notifications (workspace_id, user_id, type, title, body, link, actor_id)
    values (
      ap.workspace_id, ap.requested_by,
      case when p_decision = 'approved' then 'approval.approved' else 'approval.changes_requested' end,
      case when p_decision = 'approved' then 'Approved: ' else 'Changes requested: ' end || ap.title,
      nullif(trim(p_note), ''),
      '/app/projects/' || ap.project_id::text,
      uid
    );
  end if;

  insert into public.activity_log (workspace_id, actor_id, entity_type, entity_id, action)
  values (ap.workspace_id, uid, 'approval', ap.id, 'approval.' || p_decision::text);
end;
$$;

-- Dashboard metrics for one workspace, computed from real rows. Runs with the
-- caller's privileges so RLS still applies.
create function public.workspace_overview(p_workspace uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.is_staff(p_workspace) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'active_projects', (
      select count(*) from public.projects
      where workspace_id = p_workspace and archived_at is null
        and status not in ('delivered', 'cancelled')
    ),
    'projects_in_review', (
      select count(*) from public.projects
      where workspace_id = p_workspace and archived_at is null and status in ('in_review', 'revisions')
    ),
    'pending_approvals', (
      select count(*) from public.approvals where workspace_id = p_workspace and status = 'pending'
    ),
    'clients', (select count(*) from public.clients where workspace_id = p_workspace),
    'members', (
      select count(*) from public.workspace_members where workspace_id = p_workspace and role <> 'client'
    ),
    'overdue_tasks', (
      select count(*) from public.tasks
      where workspace_id = p_workspace and status <> 'done' and due_date < current_date
    ),
    -- Finance figures are only returned to roles that may see invoices.
    'outstanding_cents', case when private.can_manage(p_workspace) then (
      select coalesce(sum(total_cents - amount_paid_cents), 0) from public.invoices
      where workspace_id = p_workspace and status in ('sent', 'partially_paid', 'overdue')
    ) end,
    'revenue_30d_cents', case when private.can_manage(p_workspace) then (
      select coalesce(sum(amount_cents), 0) from public.payments
      where workspace_id = p_workspace and status = 'succeeded' and paid_at >= now() - interval '30 days'
    ) end
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.clients enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.workspace_counters enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.assets enable row level security;
alter table public.review_comments enable row level security;
alter table public.approvals enable row level security;
alter table public.revisions enable row level security;
alter table public.ai_generations enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_log enable row level security;

-- profiles
create policy "profiles: read self and co-members" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_workspace(id));
create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- workspaces (inserted only through create_workspace)
create policy "workspaces: members read" on public.workspaces
  for select to authenticated using (private.is_member(id));
create policy "workspaces: admins update" on public.workspaces
  for update to authenticated
  using (private.is_admin(id)) with check (private.is_admin(id));
create policy "workspaces: owner deletes" on public.workspaces
  for delete to authenticated using (owner_id = (select auth.uid()));

-- workspace_members (inserted only through RPCs)
create policy "members: read" on public.workspace_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_staff(workspace_id)
    or (private.is_member(workspace_id) and role <> 'client')
  );
create policy "members: admins update" on public.workspace_members
  for update to authenticated
  using (private.is_admin(workspace_id)) with check (private.is_admin(workspace_id));
create policy "members: admins remove or self leave" on public.workspace_members
  for delete to authenticated
  using (private.is_admin(workspace_id) or user_id = (select auth.uid()));

-- workspace_invitations
create policy "invitations: admins read" on public.workspace_invitations
  for select to authenticated using (private.is_admin(workspace_id));
create policy "invitations: admins create" on public.workspace_invitations
  for insert to authenticated
  with check (
    private.is_admin(workspace_id)
    and invited_by = (select auth.uid())
    and (role <> 'admin' or private.has_role(workspace_id, array['owner']::public.workspace_role[]))
  );
create policy "invitations: admins revoke" on public.workspace_invitations
  for delete to authenticated using (private.is_admin(workspace_id));

-- workspace_counters: no direct access (managed by triggers)

-- clients
create policy "clients: staff read, client reads own" on public.clients
  for select to authenticated
  using (private.is_staff(workspace_id) or id = private.member_client_id(workspace_id));
create policy "clients: managers create" on public.clients
  for insert to authenticated
  with check (private.can_manage(workspace_id) and created_by = (select auth.uid()));
create policy "clients: managers update" on public.clients
  for update to authenticated
  using (private.can_manage(workspace_id)) with check (private.can_manage(workspace_id));
create policy "clients: managers delete" on public.clients
  for delete to authenticated using (private.can_manage(workspace_id));

-- projects
create policy "projects: staff or bound client read" on public.projects
  for select to authenticated
  using (private.is_staff(workspace_id) or private.client_can_view_project(id));
create policy "projects: managers create" on public.projects
  for insert to authenticated
  with check (private.can_manage(workspace_id) and created_by = (select auth.uid()));
create policy "projects: staff update" on public.projects
  for update to authenticated
  using (private.is_staff(workspace_id)) with check (private.is_staff(workspace_id));
create policy "projects: managers delete" on public.projects
  for delete to authenticated using (private.can_manage(workspace_id));

-- project_members
create policy "project_members: staff read" on public.project_members
  for select to authenticated using (private.is_staff(workspace_id));
create policy "project_members: managers write" on public.project_members
  for all to authenticated
  using (private.can_manage(workspace_id)) with check (private.can_manage(workspace_id));

-- tasks (internal only)
create policy "tasks: staff read" on public.tasks
  for select to authenticated using (private.is_staff(workspace_id));
create policy "tasks: staff create" on public.tasks
  for insert to authenticated
  with check (private.is_staff(workspace_id) and created_by = (select auth.uid()));
create policy "tasks: staff update" on public.tasks
  for update to authenticated
  using (private.is_staff(workspace_id)) with check (private.is_staff(workspace_id));
create policy "tasks: creator or manager delete" on public.tasks
  for delete to authenticated
  using (private.can_manage(workspace_id) or (created_by = (select auth.uid()) and private.is_staff(workspace_id)));

-- assets
-- Evaluated on the row's own columns (not via can_view_asset) so that
-- INSERT ... RETURNING can see the row being inserted.
create policy "assets: read" on public.assets
  for select to authenticated
  using (
    private.is_staff(workspace_id)
    or (shared_with_client and status = 'ready' and private.client_can_view_project(project_id))
  );
create policy "assets: staff upload" on public.assets
  for insert to authenticated
  with check (private.is_staff(workspace_id) and uploaded_by = (select auth.uid()));
create policy "assets: staff update" on public.assets
  for update to authenticated
  using (private.is_staff(workspace_id)) with check (private.is_staff(workspace_id));
create policy "assets: uploader or manager delete" on public.assets
  for delete to authenticated
  using (private.can_manage(workspace_id) or (uploaded_by = (select auth.uid()) and private.is_staff(workspace_id)));

-- review_comments
create policy "comments: read" on public.review_comments
  for select to authenticated
  using (private.can_view_asset(asset_id) and (not is_internal or private.is_staff(workspace_id)));
create policy "comments: create" on public.review_comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and private.can_view_asset(asset_id)
    and (not is_internal or private.is_staff(workspace_id))
  );
create policy "comments: author or staff update" on public.review_comments
  for update to authenticated
  using (author_id = (select auth.uid()) or private.is_staff(workspace_id))
  with check (
    (author_id = (select auth.uid()) or private.is_staff(workspace_id))
    and (not is_internal or private.is_staff(workspace_id))
  );
create policy "comments: author or manager delete" on public.review_comments
  for delete to authenticated
  using (author_id = (select auth.uid()) or private.can_manage(workspace_id));

-- approvals (clients decide through decide_approval)
create policy "approvals: read" on public.approvals
  for select to authenticated
  using (private.is_staff(workspace_id) or private.client_can_view_project(project_id));
create policy "approvals: staff request" on public.approvals
  for insert to authenticated
  with check (private.is_staff(workspace_id) and requested_by = (select auth.uid()) and status = 'pending');
create policy "approvals: managers or requester update" on public.approvals
  for update to authenticated
  using (private.can_manage(workspace_id) or (requested_by = (select auth.uid()) and private.is_staff(workspace_id)))
  with check (private.is_staff(workspace_id));
create policy "approvals: managers delete" on public.approvals
  for delete to authenticated using (private.can_manage(workspace_id));

-- revisions
create policy "revisions: read" on public.revisions
  for select to authenticated
  using (private.is_staff(workspace_id) or private.client_can_view_project(project_id));
create policy "revisions: staff create" on public.revisions
  for insert to authenticated
  with check (private.is_staff(workspace_id) and requested_by = (select auth.uid()));
create policy "revisions: staff update" on public.revisions
  for update to authenticated
  using (private.is_staff(workspace_id)) with check (private.is_staff(workspace_id));

-- ai_generations (internal only)
create policy "ai: staff read" on public.ai_generations
  for select to authenticated using (private.is_staff(workspace_id));
create policy "ai: staff create" on public.ai_generations
  for insert to authenticated
  with check (private.is_staff(workspace_id) and created_by = (select auth.uid()));
create policy "ai: creator or manager update" on public.ai_generations
  for update to authenticated
  using (private.can_manage(workspace_id) or (created_by = (select auth.uid()) and private.is_staff(workspace_id)))
  with check (private.is_staff(workspace_id));
create policy "ai: creator or manager delete" on public.ai_generations
  for delete to authenticated
  using (private.can_manage(workspace_id) or (created_by = (select auth.uid()) and private.is_staff(workspace_id)));

-- invoices (finance roles; bound clients see non-draft invoices addressed to them)
create policy "invoices: read" on public.invoices
  for select to authenticated
  using (
    private.can_manage(workspace_id)
    or (status <> 'draft' and client_id = private.member_client_id(workspace_id))
  );
create policy "invoices: managers create" on public.invoices
  for insert to authenticated
  with check (private.can_manage(workspace_id) and created_by = (select auth.uid()) and status = 'draft');
create policy "invoices: managers update" on public.invoices
  for update to authenticated
  using (private.can_manage(workspace_id)) with check (private.can_manage(workspace_id));
create policy "invoices: managers delete drafts" on public.invoices
  for delete to authenticated using (private.can_manage(workspace_id) and status = 'draft');

-- invoice_items
create policy "invoice_items: read" on public.invoice_items
  for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id));
create policy "invoice_items: managers write drafts" on public.invoice_items
  for all to authenticated
  using (
    private.can_manage(workspace_id)
    and exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft')
  )
  with check (
    private.can_manage(workspace_id)
    and exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft')
  );

-- payments: read-only for users. Rows are written by the Stripe webhook using
-- the service-role key, or by trusted server code for manual payments.
create policy "payments: read" on public.payments
  for select to authenticated
  using (
    private.can_manage(workspace_id)
    or exists (select 1 from public.invoices i where i.id = invoice_id)
  );

-- notifications
create policy "notifications: read own" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()) and private.is_member(workspace_id));
create policy "notifications: members notify co-members" on public.notifications
  for insert to authenticated
  with check (
    private.is_member(workspace_id)
    and private.is_workspace_user(workspace_id, user_id)
    and actor_id = (select auth.uid())
  );
create policy "notifications: mark own read" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications: delete own" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));

-- activity_log (append-only)
create policy "activity: staff read" on public.activity_log
  for select to authenticated using (private.is_staff(workspace_id));
create policy "activity: members append" on public.activity_log
  for insert to authenticated
  with check (private.is_member(workspace_id) and actor_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
-- The anon role never needs table access: every page that reads data requires
-- a signed-in user.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant execute on function public.create_workspace(text, text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.decide_approval(uuid, public.approval_status, text) to authenticated;
grant execute on function public.workspace_overview(uuid) to authenticated;

revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public;
grant execute on function private.has_role(uuid, public.workspace_role[]) to authenticated;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.is_staff(uuid) to authenticated;
grant execute on function private.can_manage(uuid) to authenticated;
grant execute on function private.is_admin(uuid) to authenticated;
grant execute on function private.member_client_id(uuid) to authenticated;
grant execute on function private.is_workspace_user(uuid, uuid) to authenticated;
grant execute on function private.shares_workspace(uuid) to authenticated;
grant execute on function private.client_can_view_project(uuid) to authenticated;
grant execute on function private.can_view_project(uuid) to authenticated;
grant execute on function private.can_view_asset(uuid) to authenticated;

-- Column-level guard: users may only flip read_at on their notifications.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- -----------------------------------------------------------------------------
-- Storage buckets & policies
-- Object key convention: {workspace_id}/{project_id}/{asset_id}/{file name}
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('project-assets', 'project-assets', false, 5368709120), -- 5 GB
  ('avatars', 'avatars', false, 5242880)                   -- 5 MB
on conflict (id) do nothing;

create function private.storage_workspace_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return (string_to_array(object_name, '/'))[1]::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function private.storage_workspace_id(text) to authenticated;

create policy "project-assets: read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-assets'
    and (
      private.is_staff(private.storage_workspace_id(name))
      or exists (
        select 1 from public.assets a
        where a.storage_path = name and private.can_view_asset(a.id)
      )
    )
  );
create policy "project-assets: staff upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-assets' and private.is_staff(private.storage_workspace_id(name)));
create policy "project-assets: staff update" on storage.objects
  for update to authenticated
  using (bucket_id = 'project-assets' and private.is_staff(private.storage_workspace_id(name)));
create policy "project-assets: manager or uploader delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-assets'
    and (
      private.can_manage(private.storage_workspace_id(name))
      or (owner_id = (select auth.uid())::text and private.is_staff(private.storage_workspace_id(name)))
    )
  );

-- avatars/{user_id}/...
create policy "avatars: read" on storage.objects
  for select to authenticated using (bucket_id = 'avatars');
create policy "avatars: write own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (string_to_array(name, '/'))[1] = (select auth.uid())::text);
create policy "avatars: update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (string_to_array(name, '/'))[1] = (select auth.uid())::text);
create policy "avatars: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (string_to_array(name, '/'))[1] = (select auth.uid())::text);

-- -----------------------------------------------------------------------------
-- Realtime: stream new notifications and review comments to clients (RLS
-- still applies to realtime subscriptions).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.review_comments;
  end if;
end;
$$;
