import { redirect } from "next/navigation";
import { DesktopSidebar } from "@/components/app/sidebar";
import { MobileSidebar } from "@/components/app/mobile-sidebar";
import { NotificationsMenu } from "@/components/app/notifications-menu";
import { UserMenu } from "@/components/app/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { navForRole } from "@/lib/navigation";
import { canViewSetup } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext, ROLE_LABELS } from "@/lib/workspace";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const { user, profile, workspaces, active } = await getWorkspaceContext();
  // Client users work in the client portal; /app is the agency workspace.
  if (active.role === "client") redirect("/portal");
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

  const sidebarProps = {
    sections: navForRole(active.role),
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, roleLabel: ROLE_LABELS[w.role] })),
    activeWorkspaceId: active.id,
    showSetup: canViewSetup(active.role),
  };

  return (
    <div className="min-h-svh bg-background">
      <DesktopSidebar {...sidebarProps} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <MobileSidebar {...sidebarProps} />
          <p className="truncate text-sm font-medium text-muted-foreground lg:hidden">{active.name}</p>
          <div className="ml-auto flex items-center gap-1">
            <NotificationsMenu workspaceId={active.id} items={notifications ?? []} unreadCount={unreadCount ?? 0} />
            <ThemeToggle />
            <div className="ml-1">
              <UserMenu name={profile?.full_name ?? null} email={user.email} avatarUrl={profile?.avatar_url ?? null} />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
