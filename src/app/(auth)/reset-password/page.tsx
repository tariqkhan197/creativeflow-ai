import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { AuthHeader } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { SupabaseSetupNotice } from "@/components/setup-notice";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env/public";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  await connection();
  if (!isSupabaseConfigured) {
    return (
      <div className="grid gap-8">
        <AuthHeader title="Choose a new password" description="Password reset needs Supabase to be configured." />
        <SupabaseSetupNotice />
      </div>
    );
  }

  // The recovery link signs the user in with a short-lived session.
  const user = await getSessionUser();
  if (!user) {
    return (
      <div className="grid gap-6">
        <AuthHeader
          title="This link has expired"
          description="Password reset links can only be used once and expire after a short time."
        />
        <Button asChild size="lg" variant="brand">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <AuthHeader title="Choose a new password" description={<>Signed in as {user.email}.</>} />
      <ResetPasswordForm />
    </div>
  );
}
