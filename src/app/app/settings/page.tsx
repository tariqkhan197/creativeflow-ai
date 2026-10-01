import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ProfileForm, WorkspaceForm } from "@/components/app/settings-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ADMIN_ROLES, getWorkspaceContext, ROLE_LABELS } from "@/lib/workspace";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, profile, active } = await getWorkspaceContext();

  return (
    <div className="grid gap-8">
      <PageHeader title="Settings" description="Manage your profile and workspace." />

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How you appear to your team and clients.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm fullName={profile?.full_name ?? ""} jobTitle={profile?.job_title ?? ""} email={user.email} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            Your role in this workspace: <Badge variant="brand">{ROLE_LABELS[active.role]}</Badge>
            <span className="font-mono text-xs">/{active.slug}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkspaceForm workspaceId={active.id} name={active.name} canEdit={ADMIN_ROLES.includes(active.role)} />
        </CardContent>
      </Card>
    </div>
  );
}
