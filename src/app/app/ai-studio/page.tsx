import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FileTextIcon } from "lucide-react";
import { AiStatusBadge } from "@/components/ai/ai-status-badge";
import { ScriptBriefForm } from "@/components/ai/script-brief-form";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAiStatus } from "@/lib/ai/config";
import { AI_LIMITS, briefDefaultsFrom, usageWindowStarts, type BriefDefaults } from "@/lib/ai/studio";
import { isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatRelativeTime } from "@/lib/utils";
import { getWorkspaceContext } from "@/lib/workspace";

export const metadata: Metadata = { title: "AI Studio" };
/** Generating a script can take a couple of minutes; this covers the page's Server Action. */
export const maxDuration = 300;

const HISTORY_SIZE = 50;
const EMPTY_BRIEF: BriefDefaults = {
  title: "",
  projectId: "",
  brief: "",
  durationSeconds: "30",
  audience: "",
  tone: "",
  platform: "",
  callToAction: "",
};

export default async function AiStudioPage({ searchParams }: PageProps<"/app/ai-studio">) {
  const { user, active } = await getWorkspaceContext();
  if (!isStaff(active.role)) notFound();
  const params = await searchParams;
  const fromId = z.uuid().safeParse(params.from).data;
  const projectParam = z.uuid().safeParse(params.project).data;

  const supabase = await createClient();
  const windows = usageWindowStarts();
  const [history, projects, workspaceUsage, userUsage, source] = await Promise.all([
    supabase
      .from("ai_generations")
      .select(
        "id, title, status, project_id, created_by, created_at, doc_title:document->>title, out_title:output->>title",
      )
      .eq("workspace_id", active.id)
      .eq("kind", "script")
      .order("created_at", { ascending: false })
      .limit(HISTORY_SIZE),
    supabase
      .from("projects")
      .select("id, name")
      .eq("workspace_id", active.id)
      .is("archived_at", null)
      .order("name")
      .limit(500),
    supabase
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", active.id)
      .gt("created_at", windows.day),
    // The hourly limit is per person across workspaces; this counts what they can see.
    supabase
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gt("created_at", windows.hour),
    fromId
      ? supabase
          .from("ai_generations")
          .select("title, project_id, input")
          .eq("id", fromId)
          .eq("workspace_id", active.id)
          .eq("kind", "script")
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const failed = [history, projects, workspaceUsage, userUsage, source].find((r) => r.error);
  if (failed?.error) throw new Error(`Could not load AI Studio: ${failed.error.message}`);

  const projectList = projects.data ?? [];
  const rows = history.data ?? [];
  const usedToday = workspaceUsage.count ?? 0;
  const usedThisHour = userUsage.count ?? 0;

  const defaults: BriefDefaults = source.data ? briefDefaultsFrom(source.data) : { ...EMPTY_BRIEF };
  if (projectParam && projectList.some((p) => p.id === projectParam)) defaults.projectId = projectParam;

  const ai = getAiStatus();
  const disabledReason = !ai.configured
    ? `${ai.message ?? "AI Studio isn't set up for this deployment yet."} An administrator can set this up (see docs/SETUP.md).`
    : usedToday >= AI_LIMITS.workspacePerDay
      ? `This workspace has used all ${AI_LIMITS.workspacePerDay} AI generations for the last 24 hours. Please try again later.`
      : usedThisHour >= AI_LIMITS.userPerHour
        ? `You've used all ${AI_LIMITS.userPerHour} of your AI generations for the last hour. Please try again later.`
        : null;

  const creatorIds = [...new Set(rows.map((r) => r.created_by).filter((x): x is string => Boolean(x)))];
  const { data: profiles } = creatorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", creatorIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };
  const nameOf = (id: string | null) => {
    if (id === user.id) return "You";
    const p = profiles?.find((x) => x.id === id);
    return p?.full_name ?? p?.email ?? "Former member";
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="AI Studio"
        description={`Turn a brief into a scene-by-scene video script${ai.providerLabel ? ` with ${ai.providerLabel}` : ""}, then edit it with your team.`}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>{source.data ? "New version from an earlier brief" : "New script"}</CardTitle>
            <CardDescription>
              {source.data
                ? "The brief is filled in from the earlier script. Change anything, then generate a new version; the earlier one is kept."
                : "Describe the video. The more specific the brief, the better the script."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScriptBriefForm
              key={fromId ?? "new"}
              projects={projectList}
              defaults={defaults}
              disabledReason={disabledReason}
              dataNote={ai.dataNote}
            />
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Usage</CardTitle>
            <CardDescription>Limits protect the workspace&apos;s AI budget. Failed runs count too.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <UsageMeter label="This workspace, last 24 hours" used={usedToday} limit={AI_LIMITS.workspacePerDay} />
            <UsageMeter label="You, last hour" used={usedThisHour} limit={AI_LIMITS.userPerHour} />
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-3" aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-lg font-semibold">
          Scripts
        </h2>
        {rows.length === 0 ? (
          <EmptyState
            icon={FileTextIcon}
            title="No scripts yet"
            description="Scripts generated in this workspace appear here for the whole team."
          />
        ) : (
          <ul className="divide-y rounded-xl border bg-card" aria-label="Scripts">
            {rows.map((r) => {
              const project = projectList.find((p) => p.id === r.project_id);
              return (
                <li key={r.id}>
                  <Link
                    href={`/app/ai-studio/${r.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {r.title ?? r.doc_title ?? r.out_title ?? "Untitled script"}
                    </span>
                    {project ? <span className="text-sm text-muted-foreground">{project.name}</span> : null}
                    <span className="text-sm text-muted-foreground">
                      {nameOf(r.created_by)} · {formatRelativeTime(r.created_at)}
                    </span>
                    <AiStatusBadge status={r.status} createdAt={r.created_at} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length === HISTORY_SIZE ? (
          <p className="text-sm text-muted-foreground">Showing the latest {HISTORY_SIZE} scripts.</p>
        ) : null}
      </section>
    </div>
  );
}

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const shown = Math.min(used, limit);
  return (
    <div className="grid gap-1.5">
      <div className="flex justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {shown} / {limit}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={shown}
      >
        <div className="h-full bg-brand" style={{ width: `${(shown / limit) * 100}%` }} />
      </div>
    </div>
  );
}
