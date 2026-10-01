import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeader } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { SupabaseSetupNotice } from "@/components/setup-notice";
import { isSupabaseConfigured } from "@/lib/env/public";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div className="grid gap-8">
      <AuthHeader
        title="Reset your password"
        description="Enter the email you signed up with and we'll send you a secure reset link."
      />
      {!isSupabaseConfigured && <SupabaseSetupNotice />}
      <ForgotPasswordForm disabled={!isSupabaseConfigured} />
      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-foreground hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
