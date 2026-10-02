import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquareIcon, PlayCircleIcon, SearchXIcon } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { buildHref, Pagination } from "@/components/app/pagination";
import { AssetKindIcon } from "@/components/assets/asset-kind-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ASSET_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/media/server";
import { formatTimecode } from "@/lib/media/timecode";
import { isStaff } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatRelativeTime } from "@/lib/utils";
import { ilikeAny, parsePage } from "@/lib/validation/common";
import { reviewFiltersSchema } from "@/lib/validation/reviews";
import { getWorkspaceContext } from "@/lib/workspace";

export const metadata: Metadata = { title: "Reviews" };

const PAGE_SIZE = 24;
const KIND_LABELS = { video: "Video", image: "Images", audio: "Audio", document: "PDF" } as const;

export default async function ReviewsPage({ searchParams }: PageProps<"/app/reviews">) {
  const { active } = await getWorkspaceContext();
  // The client-portal review list arrives in Phase 4.
  if (!isStaff(active.role)) notFound();
  const params = await searchParams;
  const f = reviewFiltersSchema.parse(params);
  const page = parsePage(params.page);
  const supabase = await createClient();

  let query = supabase
    .from("asset_review_summary")
    .select("*", { count: "exact" })
    .eq("workspace_id", active.id)
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (f.project) query = query.eq("project_id", f.project);
  if (f.kind) query = query.eq("kind", f.kind);
  if (f.open) query = query.gt("open_comment_count", 0);
  if (f.q) query = query.or(ilikeAny(["name"], f.q));
  query =
    f.sort === "comments"
      ? query.order("open_comment_count", { ascending: false }).order("latest_uploaded_at", { ascending: false })
      : f.sort === "activity"
        ? query
            .order("last_comment_at", { ascending: false, nullsFirst: false })
            .order("latest_uploaded_at", { ascending: false })
        : query.order("latest_uploaded_at", { ascending: false });

  const [{ data: rows, count, error }, { data: projects }] = await Promise.all([
    query,
    supabase
      .from("projects")
      .select("id, name")
      .eq("workspace_id", active.id)
      .is("archived_at", null)
      .order("name")
      .limit(500),
  ]);
  if (error) throw new Error(`Could not load reviews: ${error.message}`);

  const thumbs = rows.map((r) => r.thumbnail_path).filter((p): p is string => Boolean(p));
  const { data: signed } = thumbs.length
    ? await supabase.storage.from(ASSET_BUCKET).createSignedUrls(thumbs, SIGNED_URL_TTL_SECONDS)
    : { data: [] };
  const thumbUrl = (p: string | null) => (p ? signed?.find((s) => s.path === p)?.signedUrl : undefined);
  const projectName = (id: string) => projects?.find((p) => p.id === id)?.name ?? "Archived project";
  const filtered = Boolean(f.q || f.project || f.kind || f.open);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Reviews"
        description="Every file ready for review across your projects, newest version first."
      />

      <form
        action="/app/reviews"
        method="get"
        role="search"
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <Input
          type="search"
          name="q"
          defaultValue={f.q}
          placeholder="Search files"
          aria-label="Search files"
          className="sm:max-w-56"
          maxLength={100}
        />
        <NativeSelect name="project" defaultValue={f.project ?? ""} aria-label="Filter by project" className="sm:w-48">
          <option value="">All projects</option>
          {(projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="kind" defaultValue={f.kind ?? ""} aria-label="Filter by file type" className="sm:w-36">
          <option value="">All types</option>
          {Object.entries(KIND_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="sort" defaultValue={f.sort} aria-label="Sort" className="sm:w-44">
          <option value="recent">Newest uploads</option>
          <option value="comments">Most open comments</option>
          <option value="activity">Latest comments</option>
        </NativeSelect>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="open"
            value="1"
            defaultChecked={Boolean(f.open)}
            className="accent-[var(--brand)]"
          />
          Open comments only
        </label>
        <Button type="submit" variant="outline">
          Apply
        </Button>
        {filtered ? (
          <Link href="/app/reviews" className="text-sm text-muted-foreground hover:text-foreground">
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState icon={SearchXIcon} title="Nothing matches" description="Try different filters, or clear them." />
        ) : (
          <EmptyState
            icon={PlayCircleIcon}
            title="Nothing to review yet"
            description="Upload cuts, stills, audio or PDFs from a project's Files & reviews section."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/app/projects">Go to projects</Link>
              </Button>
            }
          />
        )
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const url = thumbUrl(r.thumbnail_path);
            return (
              <li key={r.root_asset_id} className="overflow-hidden rounded-xl border bg-card shadow-xs">
                <Link href={`/app/projects/${r.project_id}/assets/${r.latest_asset_id}`} className="group grid">
                  <div className="relative flex aspect-video items-center justify-center bg-muted">
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                      <img src={url} alt="" className="size-full object-cover" loading="lazy" />
                    ) : (
                      <AssetKindIcon kind={r.kind} className="size-8 text-muted-foreground" />
                    )}
                    {r.duration_seconds ? (
                      <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">
                        {formatTimecode(Number(r.duration_seconds))}
                      </span>
                    ) : null}
                  </div>
                  <div className="grid gap-1.5 p-3">
                    <p className="truncate text-sm font-medium group-hover:underline">{r.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{projectName(r.project_id)}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={r.version_count > 1 ? "brand" : "secondary"}>v{r.latest_version_number}</Badge>
                      <span>{formatRelativeTime(r.latest_uploaded_at)}</span>
                      <span
                        className={`ml-auto inline-flex items-center gap-1 ${r.open_comment_count ? "font-medium text-warning" : ""}`}
                        title={`${r.open_comment_count} open comments`}
                      >
                        <MessageSquareIcon className="size-3.5" /> {r.open_comment_count}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefFor={(n) =>
          buildHref("/app/reviews", {
            q: f.q,
            project: f.project,
            kind: f.kind,
            open: f.open,
            sort: f.sort === "recent" ? undefined : f.sort,
            page: n,
          })
        }
      />
    </div>
  );
}
