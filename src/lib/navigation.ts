import type { WorkspaceRole } from "@/types/database";

export type NavIcon =
  | "dashboard"
  | "projects"
  | "clients"
  | "reviews"
  | "approvals"
  | "ai"
  | "invoices"
  | "analytics"
  | "team"
  | "settings";

export type NavItem = {
  label: string;
  href: string;
  icon: NavIcon;
  /** Roadmap phase that ships this module; undefined = available now. */
  plannedPhase?: number;
  roles?: WorkspaceRole[];
};

export type NavSection = { label?: string; items: NavItem[] };

const STAFF: WorkspaceRole[] = ["owner", "admin", "manager", "member"];
const MANAGERS: WorkspaceRole[] = ["owner", "admin", "manager"];

/**
 * Sidebar structure. Modules that are not built yet are listed with the phase
 * that delivers them and render as disabled — never as links to empty pages.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ label: "Dashboard", href: "/app", icon: "dashboard" }],
  },
  {
    label: "Production",
    items: [
      { label: "Projects", href: "/app/projects", icon: "projects", plannedPhase: 2, roles: STAFF },
      { label: "Clients", href: "/app/clients", icon: "clients", plannedPhase: 2, roles: STAFF },
      { label: "Reviews", href: "/app/reviews", icon: "reviews", plannedPhase: 3 },
      { label: "Approvals", href: "/app/approvals", icon: "approvals", plannedPhase: 4 },
      { label: "AI Studio", href: "/app/ai-studio", icon: "ai", plannedPhase: 5, roles: STAFF },
    ],
  },
  {
    label: "Business",
    items: [
      { label: "Invoices", href: "/app/invoices", icon: "invoices", plannedPhase: 6, roles: MANAGERS },
      { label: "Analytics", href: "/app/analytics", icon: "analytics", plannedPhase: 7, roles: MANAGERS },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "Team", href: "/app/team", icon: "team", roles: STAFF },
      { label: "Settings", href: "/app/settings", icon: "settings" },
    ],
  },
];

export function navForRole(role: WorkspaceRole): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.roles || item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
}
