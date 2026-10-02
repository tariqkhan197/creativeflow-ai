import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AlertCircleIcon, MailIcon, UsersIcon } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { SupabaseSetupNotice } from "@/components/setup-notice";
import { AcceptInvitationForm } from "@/components/team/accept-invitation-form";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/actions/auth";
import { getSessionUser } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env/public";
import { createClient } from "@/lib/supabase/server";
import { invitationTokenSchema } from "@/lib/validation/team";
import { ROLE_LABELS } from "@/lib/workspace";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  await connection();
  const { token } = await params;
  const path = `/invite/${token}`;

  return (
    <div className="relative min-h-svh overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-hero-glow" />
      <div className="relative mx-auto flex min-h-svh max-w-md flex-col px-4 py-8">
        <Logo />
        <main className="flex flex-1 flex-col justify-center py-12">
          <div className="grid gap-6 rounded-2xl border bg-card/80 p-6 shadow-xl shadow-black/5 backdrop-blur sm:p-8">
            <InviteBody token={token} path={path} />
          </div>
        </main>
      </div>
    </div>
  );
}

async function InviteBody({ token, path }: { token: string; path: string }) {
  if (!isSupabaseConfigured) return <SupabaseSetupNotice />;

  if (!invitationTokenSchema.safeParse(token).success) {
    return (
      <Problem
        title="This invitation link is invalid"
        body="Check that you copied the whole link, or ask for a new invitation."
      />
    );
  }

  const supabase = await createClient();
  const { data: invite, error } = await supabase.rpc("get_invitation", { p_token: token });
  if (error) {
    return (
      <Problem title="We couldn't load this invitation" body="Please refresh the page or try again in a moment." />
    );
  }
  if (!invite) {
    return (
      <Problem
        title="This invitation doesn't exist"
        body="It may have been revoked. Ask the person who invited you for a new link."
      />
    );
  }
  if (invite.status === "accepted") {
    return (
      <Problem title="This invitation has already been used" body="If it was you, you're already a member.">
        <Button asChild variant="outline">
          <Link href="/app">Go to your dashboard</Link>
        </Button>
      </Problem>
    );
  }
  if (invite.status === "expired") {
    return (
      <Problem
        title="This invitation has expired"
        body={`Ask ${invite.inviter_name ?? "the workspace admin"} to send a new one.`}
      />
    );
  }

  const user = await getSessionUser();
  const emailMatches = user && user.email.toLowerCase() === invite.email.toLowerCase();

  return (
    <>
      <div className="grid gap-3">
        <span className="inline-flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <UsersIcon className="size-5" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Join {invite.workspace_name}</h1>
        <p className="text-sm text-muted-foreground">
          {invite.inviter_name ?? "A workspace admin"} invited{" "}
          <span className="font-medium text-foreground">{invite.email}</span> to join as{" "}
          <span className="font-medium text-foreground">{ROLE_LABELS[invite.role]}</span>. The invitation expires{" "}
          {new Date(invite.expires_at).toLocaleDateString(undefined, { dateStyle: "medium" })}.
        </p>
      </div>

      {!user ? (
        <div className="grid gap-3">
          <Button asChild size="lg" variant="brand">
            <Link href={`/signup?next=${encodeURIComponent(path)}&email=${encodeURIComponent(invite.email)}`}>
              Create an account
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={`/login?next=${encodeURIComponent(path)}`}>I already have an account</Link>
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Use {invite.email} so the invitation can be matched.
          </p>
        </div>
      ) : emailMatches ? (
        <AcceptInvitationForm token={token} workspaceName={invite.workspace_name} />
      ) : (
        <div className="grid gap-4">
          <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
            <MailIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>
              You&apos;re signed in as <span className="font-medium">{user.email}</span>, but this invitation was sent
              to <span className="font-medium">{invite.email}</span>. Sign in with that address to accept it.
            </p>
          </div>
          <form action={signOut}>
            <input type="hidden" name="next" value={path} />
            <Button type="submit" variant="outline" className="w-full">
              Sign out and switch account
            </Button>
          </form>
        </div>
      )}
    </>
  );
}

function Problem({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="grid justify-items-center gap-3 text-center">
      <span className="inline-flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <AlertCircleIcon className="size-5" />
      </span>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}
