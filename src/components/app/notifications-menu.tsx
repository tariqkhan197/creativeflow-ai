"use client";

import { useOptimistic, useTransition } from "react";
import Link from "next/link";
import { BellIcon, CheckCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/actions/notifications";
import { cn, formatRelativeTime } from "@/lib/utils";

export type NotificationItem = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationsMenu({
  workspaceId,
  items,
  unreadCount,
}: {
  workspaceId: string;
  items: NotificationItem[];
  unreadCount: number;
}) {
  const [, startTransition] = useTransition();
  const [optimistic, markLocal] = useOptimistic({ items, unreadCount }, (state, id: string | "all") => ({
    items: state.items.map((n) => (id === "all" || n.id === id ? { ...n, read_at: n.read_at ?? "now" } : n)),
    unreadCount:
      id === "all" ? 0 : Math.max(0, state.unreadCount - (state.items.some((n) => n.id === id && !n.read_at) ? 1 : 0)),
  }));

  const markAll = () =>
    startTransition(async () => {
      markLocal("all");
      const res = await markAllNotificationsRead(workspaceId);
      if (!res.ok) toast.error("Could not update notifications");
    });

  const markOne = (id: string) =>
    startTransition(async () => {
      markLocal(id);
      await markNotificationRead(id);
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={optimistic.unreadCount ? `Notifications (${optimistic.unreadCount} unread)` : "Notifications"}
        >
          <BellIcon />
          {optimistic.unreadCount > 0 ? (
            <span className="absolute top-1 right-1 inline-flex min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] leading-4 font-semibold text-brand-foreground">
              {optimistic.unreadCount > 9 ? "9+" : optimistic.unreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <DropdownMenuLabel className="p-0 text-sm text-foreground">Notifications</DropdownMenuLabel>
          {optimistic.unreadCount > 0 ? (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAll}>
              <CheckCheckIcon /> Mark all read
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator className="m-0" />
        {optimistic.items.length === 0 ? (
          <div className="grid justify-items-center gap-2 px-6 py-10 text-center">
            <BellIcon className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">You&apos;re all caught up</p>
            <p className="text-xs text-muted-foreground">Approvals, comments and mentions will appear here.</p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto p-1">
            {optimistic.items.map((n) => {
              const content = (
                <>
                  <span
                    className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand")}
                    aria-hidden
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className={cn("truncate text-sm", !n.read_at && "font-medium")}>{n.title}</span>
                    {n.body ? <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span> : null}
                    <span className="text-[11px] text-muted-foreground">{formatRelativeTime(n.created_at)}</span>
                  </span>
                </>
              );
              return (
                <DropdownMenuItem
                  key={n.id}
                  asChild={Boolean(n.link)}
                  className="items-start"
                  onSelect={() => !n.read_at && markOne(n.id)}
                >
                  {n.link ? <Link href={n.link}>{content}</Link> : content}
                </DropdownMenuItem>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
