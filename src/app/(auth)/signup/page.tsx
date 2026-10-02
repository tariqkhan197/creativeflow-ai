import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeader } from "@/components/auth/auth-card";
import { SignupForm } from "@/components/auth/signup-form";
import { SupabaseSetupNotice } from "@/components/setup-notice";
import { isSupabaseConfigured } from "@/lib/env/public";
import { safeRedirectPath } from "@/lib/routes";
import { emailSchema } from "@/lib/validation/auth";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeRedirectPath(params.next, "") : "";
  const invite = next.startsWith("/invite/") ? next : undefined;
  const email = emailSchema.safeParse(params.email);

  return (
    <div className="grid gap-8">
      <AuthHeader
        title="Create your account"
        description={
          invite ? "Create your account to accept the invitation." : "Set up your agency workspace in under a minute."
        }
      />
      {!isSupabaseConfigured && <SupabaseSetupNotice />}
      <SignupForm disabled={!isSupabaseConfigured} next={invite} email={email.success ? email.data : undefined} />
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={invite ? `/login?next=${encodeURIComponent(invite)}` : "/login"}
          className="font-medium text-foreground hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
