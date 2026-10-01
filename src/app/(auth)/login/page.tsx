import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircleIcon } from "lucide-react";
import { AuthHeader } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { SupabaseSetupNotice } from "@/components/setup-notice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { isSupabaseConfigured } from "@/lib/env/public";
import { safeRedirectPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link_invalid: "That link is invalid or has expired. Request a new one and try again.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeRedirectPath(params.next) : undefined;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;

  return (
    <div className="grid gap-8">
      <AuthHeader title="Welcome back" description="Sign in to your CreativeFlow workspace." />
      {!isSupabaseConfigured && <SupabaseSetupNotice />}
      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <LoginForm next={next} disabled={!isSupabaseConfigured} />
      <p className="text-center text-sm text-muted-foreground">
        New to CreativeFlow?{" "}
        <Link href="/signup" className="font-medium text-foreground hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
