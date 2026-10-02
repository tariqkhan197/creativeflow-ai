import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { NotificationsMenu } from "@/components/app/notifications-menu";
import { UserMenu } from "@/components/app/user-menu";
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { getPortalContext } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/workspace";

export default async function PortalLayout({ children }: LayoutProps<"/portal">) {
  const { user, profile, workspaces, active } = await getPortalContext();
  const supabase = await createClient();
  const [{ data: notifications }, { count: unreadCount }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, title, body, link, read_at, created_at")
      .eq("workspace_id", active.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", active.id)
      .eq("user_id", user.id)
      .is("read_at", null),
  ]);

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link href="/portal" className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight">
            <LogoMark className="size-7" />
            <span className="hidden text-[15px] sm:inline">{active.name}</span>
            <span className="sr-only sm:hidden">{active.name} client portal</span>
          </Link>
          <span className="hidden rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline">
            Client portal
          </span>
          <div className="ml-auto flex items-center gap-1">
            {workspaces.length > 1 ? (
              <div className="w-48">
                <WorkspaceSwitcher
                  workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, roleLabel: ROLE_LABELS[w.role] }))}
                  activeId={active.id}
                />
              </div>
            ) : null}
            <NotificationsMenu workspaceId={active.id} items={notifications ?? []} unreadCount={unreadCount ?? 0} />
            <ThemeToggle />
            <div className="ml-1">
              <UserMenu
                name={profile?.full_name ?? null}
                email={user.email}
                avatarUrl={profile?.avatar_url ?? null}
                settingsHref="/portal/settings"
              />
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
