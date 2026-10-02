import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2Icon } from "lucide-react";
import { ApprovalStatusBadge } from "@/components/approvals/approval-badges";
import { CancelApprovalButton } from "@/components/approvals/approval-controls";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { buildHref, Pagination } from "@/components/app/pagination";
import { canManageWork, isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDate, formatRelativeTime } from "@/lib/utils";
import { APPROVAL_STATUS_LABELS, approvalFiltersSchema } from "@/lib/validation/approvals";
import { parsePage } from "@/lib/validation/common";
import { getWorkspaceContext } from "@/lib/workspace";

export const metadata: Metadata = { title: "Approvals" };

const PAGE_SIZE = 25;
const TABS = ["pending", "changes_requested", "approved", "cancelled", "all"] as const;

export default async function ApprovalsPage({ searchParams }: PageProps<"/app/approvals">) {
  const { user, active } = await getWorkspaceContext();
  if (!isStaff(active.role)) notFound();
  const params = await searchParams;
  const { status } = approvalFiltersSchema.parse(params);
  const page = parsePage(params.page);
  const supabase = await createClient();

  let query = supabase
    .from("approvals")
    .select(
      "id, project_id, asset_id, title, status, requested_by, decided_by, decided_at, decision_note, due_date, created_at",
      {
        count: "exact",
      },
    )
    .eq("workspace_id", active.id)
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status !== "all") query = query.eq("status", status);
  query =
    status === "pending"
      ? query.order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true })
      : query.order("updated_at", { ascending: false });

  const [{ data: rows, count, error }, { count: pendingCount }] = await Promise.all([
    query,
    supabase
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", active.id)
      .eq("status", "pending"),
  ]);
  if (error) throw new Error(`Could not load approvals: ${error.message}`);
  const list = rows ?? [];

  const projectIds = [...new Set(list.map((r) => r.project_id))];
  const assetIds = [...new Set(list.map((r) => r.asset_id).filter((x): x is string => Boolean(x)))];
  const userIds = [
    ...new Set(list.flatMap((r) => [r.requested_by, r.decided_by]).filter((x): x is string => Boolean(x))),
  ];
  const [{ data: projects }, { data: assets }, { data: profiles }] = await Promise.all([
    projectIds.length
      ? supabase.from("projects").select("id, name").in("id", projectIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    assetIds.length
      ? supabase.from("assets").select("id, name, version_number").in("id", assetIds)
      : Promise.resolve({ data: [] as { id: string; name: string; version_number: number }[] }),
    userIds.length
      ? supabase.from("profiles").select("id, full_name, email").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
  ]);
  const nameOf = (id: string | null) => {
    const p = profiles?.find((x) => x.id === id);
    return p?.full_name ?? p?.email ?? "Someone";
  };
  const canManage = canManageWork(active.role);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Approvals"
        description={
          pendingCount
            ? `${pendingCount} ${pendingCount === 1 ? "request is" : "requests are"} waiting on clients.`
            : "Sign-off requests sent to clients from the review page."
        }
      />

      <nav aria-label="Filter by status" className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t}
            href={buildHref("/app/approvals", { status: t === "pending" ? undefined : t })}
            aria-current={status === t ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              status === t
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "all" ? "All" : t === "pending" ? "Waiting" : APPROVAL_STATUS_LABELS[t]}
          </Link>
        ))}
      </nav>

      {list.length === 0 ? (
        <EmptyState
          icon={CheckCircle2Icon}
          title={status === "pending" ? "Nothing waiting on clients" : "No approvals here"}
          description="Open a file on a project's review page and choose Request approval to ask a client to sign off."
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card" aria-label="Approval requests">
          {list.map((a) => {
            const project = projects?.find((p) => p.id === a.project_id);
            const asset = assets?.find((x) => x.id === a.asset_id);
            const overdue = a.status === "pending" && a.due_date && a.due_date < today;
            return (
              <li key={a.id} className="flex flex-wrap items-start gap-3 p-4" data-approval-id={a.id}>
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {asset ? (
                      <Link
                        href={`/app/projects/${a.project_id}/assets/${asset.id}`}
                        className="min-w-0 truncate font-medium hover:underline"
                      >
                        {a.title}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate font-medium">{a.title}</span>
                    )}
                    <ApprovalStatusBadge status={a.status} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <Link href={`/app/projects/${a.project_id}`} className="hover:text-foreground hover:underline">
                      {project?.name ?? "Project"}
                    </Link>
                    {asset ? ` · ${asset.name} v${asset.version_number}` : " · deleted file"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Requested by {nameOf(a.requested_by)} {formatRelativeTime(a.created_at)}
                    {a.status !== "pending" && a.decided_at
                      ? ` · ${a.status === "cancelled" ? "cancelled" : "decided"} by ${nameOf(a.decided_by)} ${formatRelativeTime(a.decided_at)}`
                      : ""}
                  </p>
                  {a.decision_note ? (
                    <p className="mt-1 max-w-2xl rounded-md bg-muted px-2 py-1.5 text-sm whitespace-pre-wrap">
                      {a.decision_note}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {a.status === "pending" && a.due_date ? (
                    <span className={cn("text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                      {overdue ? "Overdue · " : "Due "}
                      {formatDate(a.due_date)}
                    </span>
                  ) : null}
                  {a.status === "pending" && (canManage || a.requested_by === user.id) ? (
                    <CancelApprovalButton approvalId={a.id} title={a.title} />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefFor={(p) =>
          buildHref("/app/approvals", { status: status === "pending" ? undefined : status, page: String(p) })
        }
      />
    </div>
  );
}
