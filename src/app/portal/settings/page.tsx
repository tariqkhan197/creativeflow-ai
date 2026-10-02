import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ProfileForm } from "@/components/app/settings-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPortalContext } from "@/lib/portal";

export const metadata: Metadata = { title: "Settings" };

export default async function PortalSettingsPage() {
  const { user, profile, active } = await getPortalContext();
  return (
    <div className="grid gap-8">
      <PageHeader title="Settings" description="Manage your profile." />
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How you appear to {active.name} on comments and approvals.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm fullName={profile?.full_name ?? ""} jobTitle={profile?.job_title ?? ""} email={user.email} />
        </CardContent>
      </Card>
    </div>
  );
}
