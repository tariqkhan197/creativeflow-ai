"use client";

import Link from "next/link";
import { BookOpenIcon } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { WorkspaceSwitcher, type SwitcherWorkspace } from "@/components/app/workspace-switcher";
import type { NavSection } from "@/lib/navigation";

export type SidebarProps = {
  sections: NavSection[];
  workspaces: SwitcherWorkspace[];
  activeWorkspaceId: string;
};

export function SidebarContent({
  sections,
  workspaces,
  activeWorkspaceId,
  onNavigate,
}: SidebarProps & { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 px-5">
        <Link href="/app" onClick={onNavigate} className="flex items-center gap-2.5 font-semibold tracking-tight">
          <LogoMark className="size-7" />
          <span className="text-[15px]">
            CreativeFlow <span className="text-brand">AI</span>
          </span>
        </Link>
      </div>
      <div className="px-3 pb-4">
        <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <SidebarNav sections={sections} onNavigate={onNavigate} />
      </div>
      <div className="border-t border-sidebar-border p-3">
        <Link
          href="/setup"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <BookOpenIcon className="size-4" />
          Setup &amp; integrations
        </Link>
      </div>
    </div>
  );
}

export function DesktopSidebar(props: SidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-sidebar-border bg-sidebar lg:block">
      <SidebarContent {...props} />
    </aside>
  );
}
