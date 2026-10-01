import { CheckIcon, MessageSquareIcon, PlayIcon, SparklesIcon } from "lucide-react";

/**
 * Illustrative product composition for the hero (decorative, aria-hidden).
 * It contains no metrics, customer names or claims — only UI shapes.
 */
export function HeroVisual() {
  const markers = [14, 33, 58, 81];
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-5xl">
      <div className="absolute -inset-x-10 -top-10 -bottom-6 -z-10 rounded-[2rem] bg-gradient-to-b from-brand/20 via-brand/5 to-transparent blur-2xl" />
      <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-brand/10">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-3">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 h-5 w-48 rounded-md bg-background/80" />
        </div>
        <div className="grid md:grid-cols-[1fr_280px]">
          <div className="grid gap-4 p-4 sm:p-6">
            <div className="relative aspect-video overflow-hidden rounded-xl bg-gradient-to-br from-[oklch(0.3_0.08_285)] via-[oklch(0.22_0.06_260)] to-[oklch(0.18_0.04_230)]">
              <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_70%_30%,oklch(0.7_0.15_300/0.35),transparent)]" />
              <div className="absolute inset-x-[12%] bottom-[18%] h-[38%] rounded-[50%] bg-[oklch(0.5_0.12_250/0.35)] blur-2xl" />
              <span className="absolute top-1/2 left-1/2 inline-flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur">
                <PlayIcon className="ml-0.5 size-6 fill-current" />
              </span>
              <span className="absolute top-[30%] left-[62%] size-6 rounded-full border-2 border-white/90 bg-brand/60 shadow-lg" />
            </div>
            <div className="grid gap-2">
              <div className="relative h-1.5 rounded-full bg-muted">
                <div className="h-full w-[42%] rounded-full bg-brand" />
                {markers.map((m) => (
                  <span
                    key={m}
                    className="absolute -top-1 size-3.5 -translate-x-1/2 rounded-full border-2 border-card bg-warning"
                    style={{ left: `${m}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
                <span>00:12</span>
                <span>00:30</span>
              </div>
            </div>
          </div>
          <div className="hidden border-l md:grid md:content-start md:gap-3 md:p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid gap-2 rounded-lg border bg-background/60 p-3">
                <div className="flex items-center gap-2">
                  <span className="size-6 rounded-full bg-gradient-to-br from-brand/70 to-brand/30" />
                  <span className="h-2.5 w-20 rounded bg-muted" />
                  <span className="ml-auto rounded bg-warning/15 px-1.5 font-mono text-[10px] text-warning">
                    00:{["07", "16", "24"][i]}
                  </span>
                </div>
                <span className="h-2 w-full rounded bg-muted" />
                <span className="h-2 w-2/3 rounded bg-muted" />
              </div>
            ))}
            <div className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-xs font-medium text-success">
              <CheckIcon className="size-4" /> Approve this version
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-6 -left-4 hidden items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs shadow-lg sm:flex">
        <SparklesIcon className="size-4 text-brand" /> Storyboard drafted from brief
      </div>
      <div className="absolute -top-5 -right-3 hidden items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs shadow-lg sm:flex">
        <MessageSquareIcon className="size-4 text-warning" /> Comment pinned to frame
      </div>
    </div>
  );
}
