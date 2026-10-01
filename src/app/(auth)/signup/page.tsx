import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeader } from "@/components/auth/auth-card";
import { SignupForm } from "@/components/auth/signup-form";
import { SupabaseSetupNotice } from "@/components/setup-notice";
import { isSupabaseConfigured } from "@/lib/env/public";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <div className="grid gap-8">
      <AuthHeader title="Create your account" description="Set up your agency workspace in under a minute." />
      {!isSupabaseConfigured && <SupabaseSetupNotice />}
      <SignupForm disabled={!isSupabaseConfigured} />
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
