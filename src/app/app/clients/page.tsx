import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactIcon, SearchXIcon } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { buildHref, Pagination } from "@/components/app/pagination";
import { SearchForm } from "@/components/app/search-form";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { Card } from "@/components/ui/card";
import { canManageWork, isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { ilikeAny, parsePage } from "@/lib/validation/common";
import { getWorkspaceContext } from "@/lib/workspace";

export const metadata: Metadata = { title: "Clients" };

const PAGE_SIZE = 25;

export default async function ClientsPage({ searchParams }: PageProps<"/app/clients">) {
  const { active } = await getWorkspaceContext();
  if (!isStaff(active.role)) notFound();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const page = parsePage(params.page);

  const supabase = await createClient();
  let query = supabase
    .from("clients")
    .select("id, name, company, email, phone, created_at", { count: "exact" })
    .eq("workspace_id", active.id)
    .order("name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) query = query.or(ilikeAny(["name", "company", "email"], q));
  const { data: clients, count, error } = await query;
  if (error) throw new Error(`Could not load clients: ${error.message}`);

  // Project counts for the clients on this page.
  const ids = clients.map((c) => c.id);
  const { data: projects } = ids.length
    ? await supabase.from("projects").select("client_id").in("client_id", ids).is("archived_at", null)
    : { data: [] };
  const projectCount = (id: string) => projects?.filter((p) => p.client_id === id).length ?? 0;
  const canManage = canManageWork(active.role);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Clients"
        description="The companies and people you make work for."
        actions={canManage ? <ClientFormDialog /> : null}
      />

      <SearchForm action="/app/clients" defaultValue={q} placeholder="Search name, company or email" />

      {clients.length === 0 ? (
        q ? (
          <EmptyState
            icon={SearchXIcon}
            title="No matching clients"
            description={`Nothing matches “${q}”. Try a different search.`}
            action={
              <Link href="/app/clients" className="text-sm font-medium text-brand hover:underline">
                Clear search
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={ContactIcon}
            title="No clients yet"
            description={
              canManage
                ? "Add your first client to start organising projects and invoices around them."
                : "Managers and admins can add clients."
            }
            action={canManage ? <ClientFormDialog /> : null}
          />
        )
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {clients.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/clients/${c.id}`}
                  className="grid gap-1 px-5 py-4 transition-colors hover:bg-accent/40 sm:grid-cols-[1.4fr_1.2fr_auto] sm:items-center sm:gap-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.name}</p>
                    {c.company ? <p className="truncate text-sm text-muted-foreground">{c.company}</p> : null}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{c.email ?? c.phone ?? "—"}</p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {projectCount(c.id)} active {projectCount(c.id) === 1 ? "project" : "projects"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefFor={(p) => buildHref("/app/clients", { q, page: p })}
      />
    </div>
  );
}
