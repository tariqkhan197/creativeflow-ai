"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3Icon,
  CheckCircle2Icon,
  FolderKanbanIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  PlayCircleIcon,
  ReceiptIcon,
  SettingsIcon,
  SparklesIcon,
  UsersIcon,
  ContactIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NavIcon, NavSection } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboardIcon,
  projects: FolderKanbanIcon,
  clients: ContactIcon,
  reviews: PlayCircleIcon,
  approvals: CheckCircle2Icon,
  ai: SparklesIcon,
  invoices: ReceiptIcon,
  analytics: BarChart3Icon,
  team: UsersIcon,
  settings: SettingsIcon,
};

export function SidebarNav({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="grid gap-6">
      {sections.map((section, i) => (
        <div key={section.label ?? i} className="grid gap-1">
          {section.label ? (
            <p className="px-3 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground/80 uppercase">
              {section.label}
            </p>
          ) : null}
          {section.items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);

            if (item.plannedPhase) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <span
                      aria-disabled="true"
                      className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/60"
                    >
                      <Icon className="size-4" />
                      <span className="flex-1">{item.label}</span>
                      <span className="rounded border border-border px-1.5 py-px text-[10px] font-medium">
                        Phase {item.plannedPhase}
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {item.label} ships in roadmap phase {item.plannedPhase}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                {active ? <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-sidebar-primary" /> : null}
                <Icon className={cn("size-4", active ? "text-sidebar-primary" : "text-muted-foreground")} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
