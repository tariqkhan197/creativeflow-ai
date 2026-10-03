import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2Icon, CircleDashedIcon, ExternalLinkIcon } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getIntegrationStatus } from "@/lib/env/server";
import { isSupabaseConfigured } from "@/lib/env/public";
import { requireUser } from "@/lib/auth/session";
import { canViewSetup } from "@/lib/permissions";
import { getWorkspaceContext } from "@/lib/workspace";

export const metadata: Metadata = { title: "Setup" };
// Reflect the server's current environment on every request.
export const dynamic = "force-dynamic";

const STEPS = [
  {
    title: "Create a Supabase project",
    body: (
      <>
        Create a project at{" "}
        <a
          className="font-medium underline underline-offset-4"
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noreferrer"
        >
          supabase.com/dashboard
        </a>
        . Copy the Project URL and the publishable key from <em>Project Settings → API Keys</em>.
      </>
    ),
  },
  {
    title: "Add environment variables",
    body: (
      <>
        Copy <code className="font-mono text-xs">.env.example</code> to{" "}
        <code className="font-mono text-xs">.env.local</code> and set{" "}
        <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>. On Vercel, add them under
        Project → Settings → Environment Variables.
      </>
    ),
  },
  {
    title: "Apply the database migration",
    body: (
      <>
        Run <code className="font-mono text-xs">npx supabase link</code> then{" "}
        <code className="font-mono text-xs">npx supabase db push</code>, or paste{" "}
        <code className="font-mono text-xs">supabase/migrations/*.sql</code> into the SQL editor.
      </>
    ),
  },
  {
    title: "Configure auth URLs",
    body: (
      <>
        In <em>Authentication → URL Configuration</em>, set the Site URL to your app URL and add{" "}
        <code className="font-mono text-xs">/auth/confirm</code> to the redirect allow-list. Restart the dev server.
      </>
    ),
  },
];

export default async function SetupPage() {
  // Before Supabase is connected nobody can sign in, so the setup guide is public.
  // Afterwards it is for workspace owners and admins only.
  if (isSupabaseConfigured) {
    await requireUser("/setup");
    const { active } = await getWorkspaceContext();
    if (!canViewSetup(active.role)) notFound();
  }
  const integrations = await getIntegrationStatus();

  return (
    <div className="min-h-svh">
      <header className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="mx-auto grid max-w-3xl gap-8 px-4 py-10">
        <div className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Setup &amp; integrations</h1>
          <p className="text-muted-foreground">
            CreativeFlow AI runs entirely on your own Supabase project and API keys. This page shows what is configured
            on the server — secret values are never displayed.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Integration status</CardTitle>
            <CardDescription>Only Supabase is required to sign up and use the workspace.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {integrations.map((i) => (
              <div
                key={i.key}
                className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex gap-3">
                  {i.configured ? (
                    <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-success" />
                  ) : (
                    <CircleDashedIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="grid gap-1">
                    <p className="font-medium">
                      {i.label}{" "}
                      {i.required ? (
                        <Badge variant="outline" className="ml-1 align-middle">
                          Required
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-sm text-muted-foreground">{i.purpose}</p>
                    <p className="flex flex-wrap gap-1.5">
                      {i.envVars.map((v) => (
                        <code key={v} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                          {v}
                        </code>
                      ))}
                    </p>
                  </div>
                </div>
                <Badge variant={i.configured ? "success" : "outline"} className="self-start sm:mt-0.5">
                  {i.configured ? "Configured" : "Not configured"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {!isSupabaseConfigured ? (
          <Card>
            <CardHeader>
              <CardTitle>Connect Supabase</CardTitle>
              <CardDescription>Four steps, about five minutes.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-5">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="flex gap-4">
                    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand">
                      {i + 1}
                    </span>
                    <div className="grid gap-1">
                      <p className="font-medium">{s.title}</p>
                      <p className="text-sm text-muted-foreground">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="brand">
              <Link href="/app">Back to the workspace</Link>
            </Button>
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          Full instructions, including email templates, Stripe webhooks and deployment, are in{" "}
          <a
            className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
            href="https://github.com/tariqkhan197/creativeflow-ai/blob/main/docs/SETUP.md"
            target="_blank"
            rel="noreferrer"
          >
            docs/SETUP.md <ExternalLinkIcon className="size-3" />
          </a>
          .
        </p>
      </main>
    </div>
  );
}
