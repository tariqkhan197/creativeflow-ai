"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsUpDownIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchWorkspace } from "@/lib/actions/workspace";
import { initials } from "@/lib/utils";

export type SwitcherWorkspace = { id: string; name: string; roleLabel: string };

export function WorkspaceSwitcher({ workspaces, activeId }: { workspaces: SwitcherWorkspace[]; activeId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  const select = (id: string) => {
    if (id === activeId) return;
    startTransition(async () => {
      const result = await switchWorkspace(id);
      if (!result.ok) {
        toast.error(result.error ?? "Could not switch workspace");
        return;
      }
      router.refresh();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg border bg-background/60 p-2 text-left shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label="Switch workspace"
      >
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand/90 to-brand/60 text-xs font-semibold text-brand-foreground">
          {initials(active.name)}
        </span>
        <span className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-sm font-semibold">{active.name}</span>
          <span className="truncate text-xs text-muted-foreground">{active.roleLabel}</span>
        </span>
        {pending ? (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <ChevronsUpDownIcon className="size-4 text-muted-foreground" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-60">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuCheckItem key={w.id} checked={w.id === activeId} onSelect={() => select(w.id)}>
            <span className="inline-flex size-6 items-center justify-center rounded bg-muted text-[10px] font-semibold">
              {initials(w.name)}
            </span>
            <span className="truncate">{w.name}</span>
          </DropdownMenuCheckItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding">
            <PlusIcon /> Create workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
