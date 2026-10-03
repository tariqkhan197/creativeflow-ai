import Link from "next/link";
import {
  ArrowRightIcon,
  BarChart3Icon,
  BellIcon,
  BuildingIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  FolderKanbanIcon,
  KeyRoundIcon,
  LockIcon,
  MessageSquareTextIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { HeroVisual } from "@/components/marketing/hero-visual";
import { Button } from "@/components/ui/button";

/** Available today. */
const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: FolderKanbanIcon,
    title: "Projects that track themselves",
    body: "Briefs, budgets, deadlines, tasks and status in one place, from kickoff to final delivery.",
  },
  {
    icon: MessageSquareTextIcon,
    title: "Frame-accurate video review",
    body: "Clients drop comments on the exact second that needs work. No more “the bit near the end”.",
  },
  {
    icon: CheckCircle2Icon,
    title: "Approvals with a paper trail",
    body: "Request sign-off on any version. Every decision and revision round is recorded and timestamped.",
  },
  {
    icon: UsersIcon,
    title: "A client portal they'll actually use",
    body: "Clients see only the projects and cuts you share with them — nothing internal, ever.",
  },
  {
    icon: BellIcon,
    title: "Live comments & in-app alerts",
    body: "Review comments appear live for everyone on the file, and approval requests and decisions arrive as in-app notifications.",
  },
];

/** On the roadmap, not available yet. */
const COMING_SOON: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: SparklesIcon,
    title: "AI scripts & storyboards",
    body: "Turn a brief into a structured script and shot-by-shot storyboard.",
  },
  {
    icon: ReceiptIcon,
    title: "Invoices & online payments",
    body: "Bill per project and accept card payments through Stripe.",
  },
  {
    icon: BarChart3Icon,
    title: "Analytics",
    body: "Turnaround times, revision rounds and revenue computed from your workspace records.",
  },
];

const WORKFLOW = [
  { step: "Brief", body: "Capture the client, budget, dates and goals for the project." },
  { step: "Produce", body: "Plan tasks, assign your team and upload cuts as you go." },
  { step: "Review", body: "Share a version. Clients comment on exact timestamps." },
  { step: "Approve", body: "Collect sign-off or a clear revision list, round by round." },
];

const SECURITY: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: BuildingIcon,
    title: "Isolated agency workspaces",
    body: "Every record belongs to one workspace. Isolation is enforced by Postgres row-level security, not just the UI.",
  },
  {
    icon: KeyRoundIcon,
    title: "Role-based access",
    body: "Owner, admin, manager, member and client roles decide who can see finances, internal notes and settings.",
  },
  {
    icon: LockIcon,
    title: "Secrets stay on the server",
    body: "Server credentials are only ever used server-side and are never shipped to the browser.",
  },
  {
    icon: DatabaseIcon,
    title: "Private file storage",
    body: "Media lives in private storage buckets, served through access-checked URLs scoped to the workspace.",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-hero-glow" />
        <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(60%_50%_at_50%_0%,black,transparent)]" />
        <div className="relative mx-auto grid max-w-6xl gap-14 px-4 pt-20 pb-24 sm:px-6 sm:pt-28">
          <div className="mx-auto grid max-w-3xl justify-items-center gap-6 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs backdrop-blur">
              <SparklesIcon className="size-3.5 text-brand" />
              The operating system for creative teams
            </span>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              From brief to approved cut,{" "}
              <span className="font-display font-normal text-brand italic">in one flow.</span>
            </h1>
            <p className="max-w-2xl text-lg text-pretty text-muted-foreground">
              CreativeFlow AI brings projects, frame-accurate client reviews and approvals into a single secure
              workspace for advertising agencies and video teams.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" variant="brand">
                <Link href="/signup">
                  Create your workspace <ArrowRightIcon />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="#workflow">See how it works</Link>
              </Button>
            </div>
          </div>
          <HeroVisual />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 border-t bg-muted/30">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6">
          <SectionHeading
            eyebrow="Everything in one place"
            title="Built around how creative work actually ships"
            body="Replace the patchwork of review links, spreadsheets and chat threads."
          />
          <div className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group grid content-start gap-3 bg-card p-6 transition-colors hover:bg-accent/40"
              >
                <span className="inline-flex size-10 items-center justify-center rounded-lg bg-brand/10 text-brand transition-transform group-hover:scale-105">
                  <f.icon className="size-5" />
                </span>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4" aria-labelledby="coming-soon-heading">
            <h3 id="coming-soon-heading" className="text-center text-sm font-semibold text-muted-foreground">
              Coming soon — not available yet
            </h3>
            <ul className="grid gap-3 sm:grid-cols-3">
              {COMING_SOON.map((f) => (
                <li key={f.title} className="grid content-start gap-2 rounded-xl border border-dashed p-5">
                  <div className="flex items-center gap-2">
                    <f.icon className="size-4 text-muted-foreground" />
                    <span className="font-medium">{f.title}</span>
                    <span className="ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Coming soon
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section id="workflow" className="scroll-mt-20 border-t">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6">
          <SectionHeading
            eyebrow="Workflow"
            title="One continuous pipeline"
            body="Each stage hands off to the next, so nothing gets lost between tools."
          />
          <ol className="grid gap-4 md:grid-cols-4">
            {WORKFLOW.map((w, i) => (
              <li key={w.step} className="relative grid content-start gap-3 rounded-xl border bg-card p-5">
                <span className="font-mono text-xs text-brand">0{i + 1}</span>
                <h3 className="text-lg font-semibold">{w.step}</h3>
                <p className="text-sm text-muted-foreground">{w.body}</p>
                {i < WORKFLOW.length - 1 ? (
                  <ArrowRightIcon className="absolute top-1/2 -right-3.5 z-10 hidden size-5 -translate-y-1/2 rounded-full border bg-background p-0.5 text-muted-foreground md:block" />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="scroll-mt-20 border-t bg-sidebar">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div className="grid gap-4">
            <span className="inline-flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <ShieldCheckIcon className="size-6" />
            </span>
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Your clients&apos; work stays <span className="font-display font-normal italic">theirs.</span>
            </h2>
            <p className="text-muted-foreground">
              Agencies handle unreleased campaigns and confidential budgets. CreativeFlow AI is designed so that access
              is checked at the database layer on every request.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {SECURITY.map((s) => (
              <div key={s.title} className="grid content-start gap-2 rounded-xl border bg-card p-5">
                <s.icon className="size-5 text-brand" />
                <h3 className="font-semibold">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl border bg-primary px-6 py-16 text-center text-primary-foreground sm:px-16">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_80%_at_50%_0%,color-mix(in_oklch,var(--brand)_45%,transparent),transparent)]" />
            <div className="relative mx-auto grid max-w-2xl justify-items-center gap-6">
              <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Bring your next project into CreativeFlow
              </h2>
              <p className="text-primary-foreground/70">
                Create a workspace, invite your team and share your first cut with a client.
              </p>
              <Button asChild size="lg" variant="brand">
                <Link href="/signup">
                  Get started <ArrowRightIcon />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="mx-auto grid max-w-2xl gap-3 text-center">
      <p className="text-xs font-semibold tracking-widest text-brand uppercase">{eyebrow}</p>
      <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      <p className="text-muted-foreground">{body}</p>
    </div>
  );
}
