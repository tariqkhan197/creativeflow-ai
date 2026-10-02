import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LogOutIcon, MailIcon, Trash2Icon, UsersIcon, XIcon } from "lucide-react";
import { ConfirmAction } from "@/components/app/confirm-action";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { InviteMemberDialog } from "@/components/team/invite-member-dialog";
import { MemberRoleSelect } from "@/components/team/member-role-select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { leaveWorkspace, removeMember, revokeInvitation } from "@/lib/actions/team";
import { canInvite, canLeave, canManageMember, grantableRoles, isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatRelativeTime, initials, isPast } from "@/lib/utils";
import { getWorkspaceContext, ROLE_LABELS } from "@/lib/workspace";
import type { StaffInviteRole } from "@/lib/validation/team";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const { user, active } = await getWorkspaceContext();
  if (!isStaff(active.role)) notFound();

  const supabase = await createClient();
  const isAdmin = canInvite(active.role);

  const [{ data: memberships, error }, { data: invitations, error: invError }] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("user_id, role, created_at")
      .eq("workspace_id", active.id)
      .neq("role", "client")
      .order("created_at"),
    isAdmin
      ? supabase
          .from("workspace_invitations")
          .select("id, email, role, expires_at, created_at")
          .eq("workspace_id", active.id)
          .is("accepted_at", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (error || invError) throw new Error(`Could not load the team: ${(error ?? invError)?.message}`);

  const ids = memberships.map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email, avatar_url, job_title").in("id", ids)
    : { data: [] };

  const members = memberships.map((m) => {
    const p = profiles?.find((x) => x.id === m.user_id);
    return {
      ...m,
      name: p?.full_name ?? p?.email ?? "Unknown user",
      email: p?.email ?? "",
      avatar: p?.avatar_url,
      title: p?.job_title,
    };
  });
  const roleOptions = grantableRoles(active.role);

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Team"
        description={`People with access to ${active.name}.`}
        actions={isAdmin ? <InviteMemberDialog roles={roleOptions} /> : null}
      />

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {members.length} {members.length === 1 ? "person" : "people"}
            {isAdmin ? " · Owners and admins can change roles and remove members." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {members.map((m) => {
              const isSelf = m.user_id === user.id;
              const manageable = canManageMember(
                { userId: user.id, role: active.role },
                { userId: m.user_id, role: m.role },
              );
              return (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <Avatar className="size-9 border">
                    {m.avatar ? <AvatarImage src={m.avatar} alt="" /> : null}
                    <AvatarFallback className="bg-brand/10 text-brand">{initials(m.name)}</AvatarFallback>
                  </Avatar>
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <p className="truncate text-sm font-medium">
                      {m.name} {isSelf ? <span className="text-muted-foreground">(you)</span> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.email}
                      {m.title ? ` · ${m.title}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {manageable ? (
                      <>
                        <MemberRoleSelect
                          userId={m.user_id}
                          role={m.role as StaffInviteRole}
                          options={roleOptions}
                          memberName={m.name}
                        />
                        <ConfirmAction
                          title={`Remove ${m.name}?`}
                          description="They will immediately lose access to this workspace. Their past work stays in place."
                          confirmLabel="Remove"
                          action={removeMember.bind(null, m.user_id)}
                          trigger={
                            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.name}`}>
                              <Trash2Icon />
                            </Button>
                          }
                        />
                      </>
                    ) : (
                      <Badge variant={m.role === "owner" ? "brand" : "secondary"}>{ROLE_LABELS[m.role]}</Badge>
                    )}
                    {isSelf && canLeave(active.role) ? (
                      <ConfirmAction
                        title={`Leave ${active.name}?`}
                        description="You will lose access to this workspace until someone invites you again."
                        confirmLabel="Leave workspace"
                        action={leaveWorkspace}
                        trigger={
                          <Button variant="outline" size="sm">
                            <LogOutIcon /> Leave
                          </Button>
                        }
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>Invitations that haven&apos;t been accepted yet.</CardDescription>
          </CardHeader>
          <CardContent>
            {invitations && invitations.length > 0 ? (
              <ul className="divide-y">
                {invitations.map((inv) => {
                  const expired = isPast(inv.expires_at);
                  return (
                    <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <span className="inline-flex size-9 items-center justify-center rounded-full bg-muted">
                        <MailIcon className="size-4 text-muted-foreground" />
                      </span>
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <p className="truncate text-sm font-medium">{inv.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {ROLE_LABELS[inv.role]} · invited {formatRelativeTime(inv.created_at)} ·{" "}
                          {expired ? "expired" : `expires ${formatRelativeTime(inv.expires_at)}`}
                        </p>
                      </div>
                      {expired ? <Badge variant="warning">Expired</Badge> : <Badge variant="outline">Pending</Badge>}
                      <ConfirmAction
                        title={`Revoke the invitation for ${inv.email}?`}
                        description="The invite link will stop working immediately."
                        confirmLabel="Revoke"
                        action={revokeInvitation.bind(null, inv.id)}
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
            ) : (
              <EmptyState
                icon={UsersIcon}
                title="No pending invitations"
                description="Invite producers, editors and creatives to collaborate on projects."
              />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
