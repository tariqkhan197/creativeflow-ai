-- =============================================================================
-- Keep records when a user account is deleted
--
-- Deleting an auth user sets the user references below to null (ON DELETE SET
-- NULL), keeping the comments and files. The Phase 3 triggers treated that as
-- an illegal edit and refused it, so an account that had written a comment,
-- resolved one or uploaded a file could not be deleted (for example from the
-- Supabase dashboard).
--
-- These functions are the Phase 3 versions unchanged, except that a reference
-- may now become null when the referenced user no longer exists — the same
-- rule Phase 4 uses for approvals and revision rounds. API callers still can't
-- clear or change these columns while the user exists. No data is modified by
-- this migration.
-- =============================================================================

create or replace function private.prepare_asset()
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

  -- UPDATE. uploaded_by may only become null through its foreign key, after
  -- the uploader's account was deleted (ON DELETE SET NULL); the file stays.
  if new.uploaded_by is null and old.uploaded_by is not null
     and not exists (select 1 from auth.users where id = old.uploaded_by) then
    old.uploaded_by := null;
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

create or replace function private.prepare_review_comment()
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
    new.edited_at := null;

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

  -- UPDATE. author_id and resolved_by may only become null through their
  -- foreign keys, after that account was deleted (ON DELETE SET NULL); the
  -- comment and its resolved state stay.
  if new.author_id is null and old.author_id is not null
     and not exists (select 1 from auth.users where id = old.author_id) then
    old.author_id := null;
  end if;
  if new.resolved_by is null and old.resolved_by is not null
     and not exists (select 1 from auth.users where id = old.resolved_by) then
    old.resolved_by := null;
  end if;

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
  if new.body <> old.body then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
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

revoke all on function private.prepare_asset() from public;
revoke all on function private.prepare_review_comment() from public;
