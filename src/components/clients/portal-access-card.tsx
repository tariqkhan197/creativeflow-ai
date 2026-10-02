import { MailIcon, Trash2Icon, UserRoundIcon, XIcon } from "lucide-react";
import { ConfirmAction } from "@/components/app/confirm-action";
import { EmptyState } from "@/components/app/empty-state";
import { ClientInviteDialog } from "@/components/clients/client-invite-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { removeClientUser, revokeClientInvitation } from "@/lib/actions/portal-access";
import { canManagePortalAccess } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatRelativeTime, initials, isPast } from "@/lib/utils";
import type { WorkspaceRole } from "@/types/database";

/** People who can sign in to the client portal for one client, plus pending invitations. */
export async function PortalAccessCard({
  workspaceId,
  clientId,
  clientName,
  role,
}: {
  workspaceId: string;
  clientId: string;
  clientName: string;
  role: WorkspaceRole;
}) {
  const canManage = canManagePortalAccess(role);
  const supabase = await createClient();
  const [{ data: memberships, error }, { data: invitations, error: invError }] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("user_id, created_at")
      .eq("workspace_id", workspaceId)
      .eq("role", "client")
      .eq("client_id", clientId)
      .order("created_at"),
    canManage
      ? supabase
          .from("workspace_invitations")
          .select("id, email, expires_at, created_at")
          .eq("workspace_id", workspaceId)
          .eq("role", "client")
          .eq("client_id", clientId)
          .is("accepted_at", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (error || invError) throw new Error(`Could not load portal access: ${(error ?? invError)?.message}`);

  const ids = memberships.map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email, avatar_url").in("id", ids)
    : { data: [] };
  const people = memberships.map((m) => {
    const p = profiles?.find((x) => x.id === m.user_id);
    return { ...m, name: p?.full_name ?? p?.email ?? "Unknown user", email: p?.email ?? "", avatar: p?.avatar_url };
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1.5">
          <CardTitle>Portal access</CardTitle>
          <CardDescription>
            People at {clientName} who can sign in to review shared files and approve work.
          </CardDescription>
        </div>
        {canManage ? <ClientInviteDialog clientId={clientId} clientName={clientName} /> : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        {people.length === 0 && invitations.length === 0 ? (
          <EmptyState
            icon={UserRoundIcon}
            title="No portal users yet"
            description={
              canManage
                ? "Invite a contact so they can review shared files and give approvals."
                : "An owner, admin or manager can invite this client's contacts to the portal."
            }
          />
        ) : null}
        {people.length ? (
          <ul className="divide-y">
            {people.map((p) => (
              <li key={p.user_id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <Avatar className="size-8 border">
                  {p.avatar ? <AvatarImage src={p.avatar} alt="" /> : null}
                  <AvatarFallback className="bg-brand/10 text-brand">{initials(p.name)}</AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.email} · joined {formatRelativeTime(p.created_at)}
                  </p>
                </div>
                {canManage ? (
                  <ConfirmAction
                    title={`Remove ${p.name}'s portal access?`}
                    description="They will immediately lose access to the portal. Their comments and decisions stay on record."
                    confirmLabel="Remove access"
                    action={removeClientUser.bind(null, clientId, p.user_id)}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${p.name}'s portal access`}>
                        <Trash2Icon />
                      </Button>
                    }
                  />
                ) : (
                  <Badge variant="secondary">Client</Badge>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {invitations.length ? (
          <div className="grid gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Pending invitations</p>
            <ul className="divide-y">
              {invitations.map((inv) => {
                const expired = isPast(inv.expires_at);
                return (
                  <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="inline-flex size-8 items-center justify-center rounded-full bg-muted">
                      <MailIcon className="size-4 text-muted-foreground" />
                    </span>
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <p className="truncate text-sm font-medium">{inv.email}</p>
                      <p className="text-xs text-muted-foreground">
                        Invited {formatRelativeTime(inv.created_at)} ·{" "}
                        {expired ? "expired" : `expires ${formatRelativeTime(inv.expires_at)}`}
                      </p>
                    </div>
                    {expired ? <Badge variant="warning">Expired</Badge> : <Badge variant="outline">Pending</Badge>}
                    <ConfirmAction
                      title={`Revoke the invitation for ${inv.email}?`}
                      description="The invite link will stop working immediately."
                      confirmLabel="Revoke"
                      action={revokeClientInvitation.bind(null, clientId, inv.id)}
                      trigger={
                        <Button variant="ghost" size="sm">
                          <XIcon /> Revoke
                        </Button>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
