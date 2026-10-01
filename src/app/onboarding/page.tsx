import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { CreateWorkspaceForm } from "@/components/app/create-workspace-form";
import { requireUser } from "@/lib/auth/session";
import { getUserWorkspaces } from "@/lib/workspace";

export const metadata: Metadata = { title: "Create your workspace" };

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  const workspaces = await getUserWorkspaces(user.id);

  return (
    <div className="relative min-h-svh overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-hero-glow" />
      <div className="relative mx-auto flex min-h-svh max-w-md flex-col px-4 py-8">
        <Logo href={workspaces.length ? "/app" : "/"} />
        <main className="flex flex-1 flex-col justify-center py-12">
          <div className="grid gap-8 rounded-2xl border bg-card/80 p-6 shadow-xl shadow-black/5 backdrop-blur sm:p-8">
            <div className="grid gap-2">
              <p className="text-xs font-medium tracking-wider text-brand uppercase">
                {workspaces.length ? "New workspace" : "Step 1 of 1"}
              </p>
              <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
              <p className="text-sm text-muted-foreground">
                A workspace holds your team, clients, projects and invoices. Data is fully isolated from every other
                workspace.
              </p>
            </div>
            <CreateWorkspaceForm />
          </div>
          {workspaces.length ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              <Link href="/app" className="hover:text-foreground">
                ← Back to {workspaces[0].name}
              </Link>
            </p>
          ) : (
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Joining an existing agency? Ask an admin to invite {user.email} instead.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
