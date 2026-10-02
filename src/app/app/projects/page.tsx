import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FolderKanbanIcon, SearchXIcon } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { buildHref, Pagination } from "@/components/app/pagination";
import { PriorityLabel, ProjectStatusBadge } from "@/components/projects/project-badges";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { canManageWork, isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDate } from "@/lib/utils";
import { ilikeAny, parsePage } from "@/lib/validation/common";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, projectFiltersSchema } from "@/lib/validation/projects";
import { getWorkspaceContext } from "@/lib/workspace";

export const metadata: Metadata = { title: "Projects" };

const PAGE_SIZE = 20;

export default async function ProjectsPage({ searchParams }: PageProps<"/app/projects">) {
  const { active } = await getWorkspaceContext();
  if (!isStaff(active.role)) notFound();
  const params = await searchParams;
  const filters = projectFiltersSchema.parse(params);
  const page = parsePage(params.page);
  const canManage = canManageWork(active.role);
  const supabase = await createClient();

  let query = supabase
    .from("projects")
    .select("id, name, status, priority, due_date, client_id, updated_at", { count: "exact" })
    .eq("workspace_id", active.id)
    .order("updated_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  query = filters.view === "archived" ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.client) query = query.eq("client_id", filters.client);
  if (filters.q) query = query.or(ilikeAny(["name", "description"], filters.q));

  const [{ data: projects, count, error }, { data: clients, error: cError }] = await Promise.all([
    query,
    supabase.from("clients").select("id, name").eq("workspace_id", active.id).order("name").limit(500),
  ]);
  if (error || cError) throw new Error(`Could not load projects: ${(error ?? cError)?.message}`);

  const ids = projects.map((p) => p.id);
  const { data: tasks } = ids.length
    ? await supabase.from("tasks").select("project_id, status").in("project_id", ids)
    : { data: [] };
  const progress = (id: string) => {
    const mine = tasks?.filter((t) => t.project_id === id) ?? [];
    return { done: mine.filter((t) => t.status === "done").length, total: mine.length };
  };
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name;
  const today = new Date().toISOString().slice(0, 10);
  const filtered = Boolean(filters.q || filters.status || filters.client);
  const openNew = canManage && params.new === "1";
  const newClient =
    typeof params.client === "string" && clients.some((c) => c.id === params.client) ? params.client : undefined;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Projects"
        description="Every production, from brief to delivery."
        actions={
          canManage ? (
            <ProjectFormDialog
              clients={clients}
              defaultCurrency={active.default_currency}
              defaultClientId={newClient}
              defaultOpen={openNew}
            />
          ) : null
        }
      />

      <form
        action="/app/projects"
        method="get"
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
        role="search"
      >
        {filters.view === "archived" ? <input type="hidden" name="view" value="archived" /> : null}
        <Input
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder="Search projects"
          aria-label="Search projects"
          className="sm:max-w-60"
          maxLength={100}
        />
        <NativeSelect
          name="status"
          defaultValue={filters.status ?? ""}
          aria-label="Filter by status"
          className="sm:w-44"
        >
          <option value="">All statuses</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          name="client"
          defaultValue={filters.client ?? ""}
          aria-label="Filter by client"
          className="sm:w-48"
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline">
          Apply
        </Button>
        {filtered ? (
          <Link
            href={buildHref("/app/projects", { view: filters.view === "archived" ? "archived" : undefined })}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Clear
          </Link>
        ) : null}
        <div className="flex gap-1 rounded-lg border p-1 text-sm sm:ml-auto">
          {(["active", "archived"] as const).map((view) => (
            <Link
              key={view}
              href={buildHref("/app/projects", { view: view === "archived" ? "archived" : undefined })}
              aria-current={filters.view === view ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1 capitalize transition-colors",
                filters.view === view
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {view}
            </Link>
          ))}
        </div>
      </form>

      {projects.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchXIcon}
            title="No matching projects"
            description="Try a different search or clear the filters."
          />
        ) : filters.view === "archived" ? (
          <EmptyState
            icon={FolderKanbanIcon}
            title="No archived projects"
            description="Projects you archive are kept here."
          />
        ) : (
          <EmptyState
            icon={FolderKanbanIcon}
            title="No projects yet"
            description={
              canManage
                ? "Create your first project to start tracking work."
                : "Managers and admins can create projects."
            }
            action={
              canManage ? <ProjectFormDialog clients={clients} defaultCurrency={active.default_currency} /> : null
            }
          />
        )
      ) : (
        <Card className="gap-0 py-0">
          <div className="hidden grid-cols-[2fr_1fr_0.8fr_0.9fr_0.9fr] gap-4 border-b px-5 py-2.5 text-xs font-medium text-muted-foreground md:grid">
            <span>Project</span>
            <span>Status</span>
            <span>Priority</span>
            <span>Due</span>
            <span>Tasks</span>
          </div>
          <ul className="divide-y">
            {projects.map((p) => {
              const { done, total } = progress(p.id);
              const overdue =
                p.due_date && p.due_date < today && !["delivered", "cancelled", "approved"].includes(p.status);
              return (
                <li key={p.id}>
                  <Link
                    href={`/app/projects/${p.id}`}
                    className="grid gap-2 px-5 py-4 transition-colors hover:bg-accent/40 md:grid-cols-[2fr_1fr_0.8fr_0.9fr_0.9fr] md:items-center md:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="truncate text-sm text-muted-foreground">{clientName(p.client_id) ?? "No client"}</p>
                    </div>
                    <div>
                      <ProjectStatusBadge status={p.status} />
                    </div>
                    <div>
                      <PriorityLabel priority={p.priority} />
                    </div>
                    <p className={cn("text-sm", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                      {p.due_date ? `${overdue ? "Overdue · " : ""}${formatDate(p.due_date)}` : "No due date"}
                    </p>
                    <div className="grid gap-1">
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {total ? `${done}/${total} done` : "No tasks"}
                      </p>
                      {total ? (
                        <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <div className="h-full rounded-full bg-brand" style={{ width: `${(done / total) * 100}%` }} />
                        </div>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefFor={(n) =>
          buildHref("/app/projects", {
            q: filters.q,
            status: filters.status,
            client: filters.client,
            view: filters.view === "archived" ? "archived" : undefined,
            page: n,
          })
        }
      />
    </div>
  );
}
