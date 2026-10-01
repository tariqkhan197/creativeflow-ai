-- =============================================================================
-- Explicit Data API privileges
--
-- Supabase projects can be created with automatic grants for new tables turned
-- off. The initial migration relied on the default privileges, so grant what
-- the app needs explicitly. RLS still decides which ROWS each user can touch;
-- these grants only decide which roles may attempt a statement at all.
-- Idempotent: safe whether or not default grants already exist.
-- =============================================================================

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- The anon role never needs table access (re-assert after the grants above).
revoke all on all tables in schema public from anon;

-- Re-apply the column-level guard from the initial migration: users may only
-- change read_at on their own notifications.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Server-side trusted code (service_role) may call the RPCs too.
grant execute on function public.create_workspace(text, text) to service_role;
grant execute on function public.accept_invitation(text) to service_role;
grant execute on function public.decide_approval(uuid, public.approval_status, text) to service_role;
grant execute on function public.workspace_overview(uuid) to service_role;
