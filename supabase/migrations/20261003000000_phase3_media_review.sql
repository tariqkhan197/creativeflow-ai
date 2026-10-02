-- =============================================================================
-- Phase 3: media uploads, versions, review comments
--
-- Builds on public.assets / public.review_comments from the initial schema.
-- Nothing here weakens an existing policy: storage INSERT/UPDATE become
-- stricter, and SELECT additionally covers an asset's thumbnail object.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- File types
-- -----------------------------------------------------------------------------

-- The single allowlist of MIME types (kept in sync with src/lib/media/file-types.ts).
create function private.asset_kind_for_mime(mime text)
returns public.asset_kind
language sql
immutable
set search_path = ''
as $$
  select case
    when mime in ('video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/x-m4v', 'video/x-msvideo')
      then 'video'::public.asset_kind
    when mime in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/tiff')
      then 'image'::public.asset_kind
    when mime in ('audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac')
      then 'audio'::public.asset_kind
    when mime = 'application/pdf'
      then 'document'::public.asset_kind
    else null
  end;
$$;

update storage.buckets
set allowed_mime_types = array[
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/x-m4v', 'video/x-msvideo',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/tiff',
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac',
  'application/pdf'
]
where id = 'project-assets';

-- Bucket-level upload limit (bytes) and allowed types, for the upload UI.
-- The project-wide limit (Storage settings, plan dependent) is not readable
-- from SQL; see docs/SETUP.md.
create function public.asset_upload_constraints()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'file_size_limit', b.file_size_limit,
    'allowed_mime_types', to_jsonb(b.allowed_mime_types)
  )
  from storage.buckets b
  where b.id = 'project-assets';
$$;

revoke all on function public.asset_upload_constraints() from public;
grant execute on function public.asset_upload_constraints() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Asset columns & constraints
-- -----------------------------------------------------------------------------
alter table public.assets
  add column thumbnail_path text unique,
  add column frame_rate numeric(7, 3) check (frame_rate is null or (frame_rate > 0 and frame_rate <= 1000)),
  add column upload_error text check (char_length(upload_error) <= 500);

-- NOT VALID: enforced for every new/updated row without failing on any legacy row.
alter table public.assets
  add constraint assets_kind_matches_mime check (kind = private.asset_kind_for_mime(mime_type)) not valid;

-- One row per (original, version number).
create unique index assets_version_unique on public.assets (coalesce(root_asset_id, id), version_number);

-- {workspace_id}/{project_id}/{asset_id}/thumbnail.jpg
create function private.asset_thumbnail_path(storage_path text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(storage_path, '[^/]+$', 'thumbnail.jpg');
$$;

create function private.prepare_asset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  root public.assets%rowtype;
  bucket_limit bigint;
  file_name text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'uploading' then
      raise exception 'New assets must start in the uploading state' using errcode = '23514';
    end if;
    if private.asset_kind_for_mime(new.mime_type) is null then
      raise exception 'This file type is not supported' using errcode = '23514';
    end if;
    new.kind := private.asset_kind_for_mime(new.mime_type);

    -- Path must be exactly {workspace}/{project}/{asset id}/{safe file name}.
    file_name := substring(new.storage_path from '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/([^/]+)$');
    if new.storage_path <> new.workspace_id::text || '/' || new.project_id::text || '/' || new.id::text || '/' || coalesce(file_name, '')
       or file_name is null
       or file_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
       or lower(file_name) = 'thumbnail.jpg' then
      raise exception 'Invalid storage path for this asset' using errcode = '23514';
    end if;

    if new.size_bytes <= 0 then
      raise exception 'The file is empty' using errcode = '23514';
    end if;
    select file_size_limit into bucket_limit from storage.buckets where id = 'project-assets';
    if bucket_limit is not null and new.size_bytes > bucket_limit then
      raise exception 'The file is larger than the % byte upload limit', bucket_limit using errcode = '23514';
    end if;

    new.thumbnail_path := null;
    new.upload_error := null;
    new.shared_with_client := false;

    if new.root_asset_id is null then
      new.version_number := 1;
    else
      -- Lock the original so concurrent new versions are numbered one at a time.
      select * into root from public.assets where id = new.root_asset_id for update;
      if not found or root.root_asset_id is not null then
        raise exception 'A new version must be added to the original asset' using errcode = '23514';
      end if;
      if root.project_id <> new.project_id or root.workspace_id <> new.workspace_id then
        raise exception 'A version must belong to the same project as the original' using errcode = '23514';
      end if;
      if root.kind <> new.kind then
        raise exception 'A new version must be the same kind of file as the original' using errcode = '23514';
      end if;
      select coalesce(max(version_number), 0) + 1 into new.version_number
      from public.assets
      where id = new.root_asset_id or root_asset_id = new.root_asset_id;
    end if;
    return new;
  end if;

  -- UPDATE: identity, location and type never change.
  if new.id <> old.id or new.workspace_id <> old.workspace_id or new.project_id <> old.project_id
     or new.storage_path <> old.storage_path or new.mime_type <> old.mime_type or new.kind <> old.kind
     or new.root_asset_id is distinct from old.root_asset_id or new.version_number <> old.version_number
     or new.size_bytes <> old.size_bytes or new.uploaded_by is distinct from old.uploaded_by then
    raise exception 'An asset''s file, project, type and version cannot be changed' using errcode = '23514';
  end if;

  if new.status <> old.status and not (
    (old.status = 'uploading' and new.status in ('ready', 'failed'))
    or (old.status = 'failed' and new.status = 'uploading')
  ) then
    raise exception 'Invalid asset status change from % to %', old.status, new.status using errcode = '23514';
  end if;

  -- Media metadata is recorded once, while the upload is in progress or being finalized.
  if old.status = 'ready' and (
    new.duration_seconds is distinct from old.duration_seconds or new.width is distinct from old.width
    or new.height is distinct from old.height or new.frame_rate is distinct from old.frame_rate
  ) then
    raise exception 'Media metadata cannot be changed after the upload is complete' using errcode = '23514';
  end if;

  if new.thumbnail_path is distinct from old.thumbnail_path
     and new.thumbnail_path is not null
     and new.thumbnail_path <> private.asset_thumbnail_path(new.storage_path) then
    raise exception 'Invalid thumbnail path' using errcode = '23514';
  end if;

  if new.status = 'ready' then
    new.upload_error := null;
  end if;
  return new;
end;
$$;

create trigger assets_prepare before insert or update on public.assets
  for each row execute function private.prepare_asset();

-- Finalize an upload after verifying the stored object against the asset row.
create function public.finalize_asset_upload(
  p_asset uuid,
  p_duration_seconds numeric default null,
  p_width integer default null,
  p_height integer default null,
  p_frame_rate numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  a public.assets%rowtype;
  stored_size bigint;
  stored_type text;
  has_thumbnail boolean;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into a from public.assets where id = p_asset for update;
  if not found or not private.is_staff(a.workspace_id)
     or (a.uploaded_by is distinct from uid and not private.can_manage(a.workspace_id)) then
    raise exception 'Asset not found' using errcode = '42501';
  end if;
  if a.status = 'ready' then
    return jsonb_build_object('status', 'ready', 'already', true);
  end if;
  if a.status <> 'uploading' then
    raise exception 'This upload is not in progress' using errcode = '22023';
  end if;

  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
    into stored_size, stored_type
  from storage.objects o
  where o.bucket_id = 'project-assets' and o.name = a.storage_path;

  if not found then
    raise exception 'The uploaded file was not found in storage' using errcode = '22023';
  end if;
  if stored_size is distinct from a.size_bytes then
    raise exception 'The uploaded file size (% bytes) does not match the expected size (% bytes)',
      coalesce(stored_size::text, 'unknown'), a.size_bytes using errcode = '22023';
  end if;
  if stored_type is distinct from a.mime_type then
    raise exception 'The uploaded file type does not match' using errcode = '22023';
  end if;

  select exists (
    select 1 from storage.objects o
    where o.bucket_id = 'project-assets' and o.name = private.asset_thumbnail_path(a.storage_path)
  ) into has_thumbnail;

  update public.assets
  set status = 'ready',
      duration_seconds = case when a.kind in ('video', 'audio') and p_duration_seconds > 0 then p_duration_seconds end,
      width = case when a.kind in ('video', 'image') and p_width > 0 then p_width end,
      height = case when a.kind in ('video', 'image') and p_height > 0 then p_height end,
      frame_rate = case when a.kind = 'video' and p_frame_rate > 0 and p_frame_rate <= 1000 then p_frame_rate end,
      thumbnail_path = case when has_thumbnail then private.asset_thumbnail_path(a.storage_path) end
  where id = a.id;

  return jsonb_build_object('status', 'ready', 'thumbnail', has_thumbnail);
end;
$$;

revoke all on function public.finalize_asset_upload(uuid, numeric, integer, integer, numeric) from public;
grant execute on function public.finalize_asset_upload(uuid, numeric, integer, integer, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- Storage policies for project-assets
-- -----------------------------------------------------------------------------

-- An upload target: the asset's file or its thumbnail, while the caller's
-- upload is still in progress.
create function private.can_write_asset_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assets a
    where (a.storage_path = object_name or private.asset_thumbnail_path(a.storage_path) = object_name)
      and a.status = 'uploading'
      and a.uploaded_by = (select auth.uid())
      and private.is_staff(a.workspace_id)
  );
$$;

grant execute on function private.can_write_asset_object(text) to authenticated;

drop policy "project-assets: staff upload" on storage.objects;
create policy "project-assets: upload to own in-progress asset" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-assets' and private.can_write_asset_object(name));

drop policy "project-assets: staff update" on storage.objects;
create policy "project-assets: update own in-progress asset" on storage.objects
  for update to authenticated
  using (bucket_id = 'project-assets' and private.can_write_asset_object(name))
  with check (bucket_id = 'project-assets' and private.can_write_asset_object(name));

-- Staff of the workspace, or anyone who may view the asset the object belongs
-- to (its file or thumbnail). The object name is qualified explicitly: the
-- initial migration's unqualified `name` inside the subquery resolved to
-- assets.name, so its client branch never matched (fixed here).
drop policy "project-assets: read" on storage.objects;
create policy "project-assets: read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-assets'
    and (
      private.is_staff(private.storage_workspace_id(objects.name))
      or exists (
        select 1 from public.assets a
        where (a.storage_path = objects.name or a.thumbnail_path = objects.name)
          and private.can_view_asset(a.id)
      )
    )
  );
-- "project-assets: manager or uploader delete" is unchanged.

-- -----------------------------------------------------------------------------
-- Review comments
-- -----------------------------------------------------------------------------
create function private.is_valid_annotation(a jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select a is null or (
    jsonb_typeof(a) = 'object'
    and (select count(*) from jsonb_object_keys(a)) = 2
    and jsonb_typeof(a -> 'x') = 'number' and jsonb_typeof(a -> 'y') = 'number'
    and (a ->> 'x')::numeric between 0 and 1
    and (a ->> 'y')::numeric between 0 and 1
  );
$$;

alter table public.review_comments
  add constraint review_comments_annotation_valid check (private.is_valid_annotation(annotation)) not valid;

create index review_comments_parent_idx on public.review_comments (parent_id) where parent_id is not null;
create index review_comments_open_idx on public.review_comments (asset_id) where parent_id is null and resolved_at is null;

create function private.prepare_review_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  a public.assets%rowtype;
  parent public.review_comments%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into a from public.assets where id = new.asset_id;
    if not found or a.status <> 'ready' then
      raise exception 'Comments can only be added to an uploaded file' using errcode = '23514';
    end if;

    new.resolved_at := null;
    new.resolved_by := null;

    if new.parent_id is not null then
      select * into parent from public.review_comments where id = new.parent_id;
      if not found or parent.asset_id <> new.asset_id then
        raise exception 'A reply must belong to the same file as its comment' using errcode = '23514';
      end if;
      if parent.parent_id is not null then
        raise exception 'Replies can only be one level deep' using errcode = '23514';
      end if;
      -- Replies inherit the thread's position and visibility.
      new.timestamp_seconds := null;
      new.annotation := null;
      new.is_internal := parent.is_internal or new.is_internal;
    else
      if new.timestamp_seconds is not null then
        if a.kind not in ('video', 'audio') then
          raise exception 'Timestamps are only available on video and audio' using errcode = '23514';
        end if;
        if a.duration_seconds is not null and new.timestamp_seconds > a.duration_seconds + 0.5 then
          raise exception 'The timestamp is past the end of the media' using errcode = '23514';
        end if;
      end if;
      if new.annotation is not null and a.kind not in ('video', 'image') then
        raise exception 'Pins are only available on video and images' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.asset_id <> old.asset_id or new.workspace_id <> old.workspace_id
     or new.parent_id is distinct from old.parent_id or new.author_id is distinct from old.author_id
     or new.is_internal <> old.is_internal
     or new.timestamp_seconds is distinct from old.timestamp_seconds
     or new.annotation is distinct from old.annotation then
    raise exception 'Only the comment text and resolved state can be changed' using errcode = '23514';
  end if;

  if new.body <> old.body and actor is not null and actor is distinct from old.author_id then
    raise exception 'Only the author can edit a comment' using errcode = '42501';
  end if;

  if new.resolved_at is distinct from old.resolved_at then
    if old.parent_id is not null then
      raise exception 'Replies cannot be resolved; resolve the comment thread instead' using errcode = '23514';
    end if;
    if actor is not null and not private.is_staff(new.workspace_id) then
      raise exception 'Only the team can resolve comments' using errcode = '42501';
    end if;
    if new.resolved_at is null then
      new.resolved_by := null;
    else
      new.resolved_at := now();
      new.resolved_by := actor;
    end if;
  elsif new.resolved_by is distinct from old.resolved_by then
    raise exception 'Only the comment text and resolved state can be changed' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger review_comments_prepare before insert or update on public.review_comments
  for each row execute function private.prepare_review_comment();

-- -----------------------------------------------------------------------------
-- Activity triggers
-- -----------------------------------------------------------------------------
create function private.audit_assets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.status = 'ready' and old.status <> 'ready' then
      if new.root_asset_id is null then
        perform private.log_activity(new.workspace_id, 'asset', new.id, 'asset.uploaded',
          jsonb_build_object('name', new.name, 'kind', new.kind, 'project_id', new.project_id));
      else
        perform private.log_activity(new.workspace_id, 'asset', new.root_asset_id, 'asset.version_added',
          jsonb_build_object('name', new.name, 'version', new.version_number, 'project_id', new.project_id));
      end if;
    end if;
  elsif tg_op = 'DELETE' and old.status = 'ready' then
    -- Skip rows removed by a cascade (their project or original is already gone).
    if exists (select 1 from public.projects where id = old.project_id)
       and (old.root_asset_id is null or exists (select 1 from public.assets where id = old.root_asset_id)) then
      perform private.log_activity(old.workspace_id, 'asset', coalesce(old.root_asset_id, old.id), 'asset.deleted',
        jsonb_build_object('name', old.name, 'version', old.version_number, 'project_id', old.project_id));
    end if;
  end if;
  return null;
end;
$$;

create trigger assets_audit after update of status or delete on public.assets
  for each row execute function private.audit_assets();

create function private.audit_review_comments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  root_id uuid;
  project uuid;
begin
  select coalesce(a.root_asset_id, a.id), a.project_id into root_id, project
  from public.assets a where a.id = new.asset_id;

  if tg_op = 'INSERT' then
    perform private.log_activity(new.workspace_id, 'comment', new.id, 'comment.created',
      jsonb_build_object('asset_id', new.asset_id, 'root_asset_id', root_id, 'project_id', project,
                         'reply', new.parent_id is not null, 'internal', new.is_internal));
  elsif new.resolved_at is not null and old.resolved_at is null then
    perform private.log_activity(new.workspace_id, 'comment', new.id, 'comment.resolved',
      jsonb_build_object('asset_id', new.asset_id, 'root_asset_id', root_id, 'project_id', project));
  end if;
  return null;
end;
$$;

create trigger review_comments_audit after insert or update of resolved_at on public.review_comments
  for each row execute function private.audit_review_comments();

-- -----------------------------------------------------------------------------
-- Review summary: one row per original asset with its latest ready version and
-- open (unresolved, top-level) comment count on that version. security_invoker
-- means the caller's RLS applies to every underlying table.
-- -----------------------------------------------------------------------------
create view public.asset_review_summary
with (security_invoker = true)
as
select
  coalesce(v.root_asset_id, v.id) as root_asset_id,
  v.id as latest_asset_id,
  v.workspace_id,
  v.project_id,
  v.name,
  v.kind,
  v.mime_type,
  v.version_number as latest_version_number,
  v.thumbnail_path,
  v.duration_seconds,
  v.created_at as latest_uploaded_at,
  (select count(*) from public.assets x
     where (x.id = coalesce(v.root_asset_id, v.id) or x.root_asset_id = coalesce(v.root_asset_id, v.id))
       and x.status = 'ready')::int as version_count,
  (select count(*) from public.review_comments c
     where c.asset_id = v.id and c.parent_id is null and c.resolved_at is null)::int as open_comment_count,
  (select max(c.created_at) from public.review_comments c where c.asset_id = v.id) as last_comment_at
from (
  select distinct on (coalesce(a.root_asset_id, a.id)) a.*
  from public.assets a
  where a.status = 'ready'
  order by coalesce(a.root_asset_id, a.id), a.version_number desc
) v;

revoke all on public.asset_review_summary from anon;
grant select on public.asset_review_summary to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Realtime (review_comments was added in the initial migration when the
-- publication existed; add it now only if it is missing).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'review_comments'
     ) then
    alter publication supabase_realtime add table public.review_comments;
  end if;
end;
$$;

-- Internal helpers are not callable directly.
revoke all on function private.prepare_asset() from public;
revoke all on function private.prepare_review_comment() from public;
revoke all on function private.audit_assets() from public;
revoke all on function private.audit_review_comments() from public;
grant execute on function private.asset_kind_for_mime(text) to authenticated;
grant execute on function private.asset_thumbnail_path(text) to authenticated;
grant execute on function private.is_valid_annotation(jsonb) to authenticated;
