import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { navForRole } from "@/lib/navigation";
import { SidebarNav } from "./sidebar-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/app" }));

describe("SidebarNav", () => {
  it("labels unbuilt modules 'Coming soon', never with internal roadmap phases", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <SidebarNav sections={navForRole("owner")} />
      </TooltipProvider>,
    );
    expect(html).not.toMatch(/Phase\s*\d/i);
    expect(html.match(/Coming soon/g)?.length).toBe(2); // Invoices, Analytics
    expect(html).toContain('href="/app/approvals"');
    expect(html).toContain('href="/app/ai-studio"');
    expect(html).not.toContain('href="/app/invoices"');
  });
});
