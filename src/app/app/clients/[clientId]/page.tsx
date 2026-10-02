import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeftIcon, FolderKanbanIcon, MailIcon, PhoneIcon, Trash2Icon } from "lucide-react";
import { ConfirmAction } from "@/components/app/confirm-action";
import { EmptyState } from "@/components/app/empty-state";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ProjectStatusBadge } from "@/components/projects/project-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteClientRecord } from "@/lib/actions/clients";
import { canManageWork, isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { getWorkspaceContext } from "@/lib/workspace";

export const metadata: Metadata = { title: "Client" };

export default async function ClientPage({ params }: PageProps<"/app/clients/[clientId]">) {
  const { active } = await getWorkspaceContext();
  if (!isStaff(active.role)) notFound();
  const { clientId } = await params;
  if (!z.uuid().safeParse(clientId).success) notFound();

  const supabase = await createClient();
  const [{ data: client, error }, { data: projects, error: pError }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", clientId).eq("workspace_id", active.id).maybeSingle(),
    supabase
      .from("projects")
      .select("id, name, status, due_date, archived_at")
      .eq("client_id", clientId)
      .eq("workspace_id", active.id)
      .order("updated_at", { ascending: false }),
  ]);
  if (error || pError) throw new Error(`Could not load the client: ${(error ?? pError)?.message}`);
  if (!client) notFound();
  const canManage = canManageWork(active.role);

  return (
    <div className="grid gap-6">
      <Link
        href="/app/clients"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" /> Clients
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          {client.company ? <p className="text-muted-foreground">{client.company}</p> : null}
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <ClientFormDialog client={client} />
            <ConfirmAction
              title={`Delete ${client.name}?`}
              description="The client record is deleted permanently. Its projects are kept, without a client."
              confirmLabel="Delete client"
              action={deleteClientRecord.bind(null, client.id, true)}
              trigger={
                <Button variant="outline" aria-label="Delete client">
                  <Trash2Icon /> Delete
                </Button>
              }
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {client.email ? (
              <a href={`mailto:${client.email}`} className="flex items-center gap-2 hover:underline">
                <MailIcon className="size-4 text-muted-foreground" /> {client.email}
              </a>
            ) : null}
            {client.phone ? (
              <a href={`tel:${client.phone}`} className="flex items-center gap-2 hover:underline">
                <PhoneIcon className="size-4 text-muted-foreground" /> {client.phone}
              </a>
            ) : null}
            {!client.email && !client.phone ? <p className="text-muted-foreground">No contact details yet.</p> : null}
            {client.notes ? (
              <p className="border-t pt-3 whitespace-pre-wrap text-muted-foreground">{client.notes}</p>
            ) : null}
            <p className="border-t pt-3 text-xs text-muted-foreground">Added {formatDate(client.created_at)}</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {projects.length ? (
              <ul className="divide-y">
                {projects.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/app/projects/${p.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-3 hover:underline"
                    >
                      <span className="font-medium">
                        {p.name}
                        {p.archived_at ? <span className="ml-2 text-xs text-muted-foreground">(archived)</span> : null}
                      </span>
                      <span className="flex items-center gap-3 text-sm text-muted-foreground">
                        {p.due_date ? `Due ${formatDate(p.due_date)}` : null}
                        <ProjectStatusBadge status={p.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={FolderKanbanIcon}
                title="No projects for this client"
                description="Projects you create for this client will be listed here."
                action={
                  canManage ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/app/projects?new=1&client=${client.id}`}>Create a project</Link>
                    </Button>
                  ) : null
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
