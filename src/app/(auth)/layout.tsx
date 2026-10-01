import Link from "next/link";
import { CheckIcon } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";

const POINTS = [
  "Isolated workspaces for every agency, enforced in the database",
  "Frame-accurate client reviews and approval trails",
  "AI scripts and storyboards grounded in your project brief",
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_minmax(0,0.9fr)]">
      <div className="flex flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Logo />
          <ThemeToggle />
        </div>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">{children}</main>
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            ← Back to home
          </Link>
        </p>
      </div>
      <aside className="relative hidden overflow-hidden border-l bg-sidebar lg:block">
        <div className="absolute inset-0 bg-grid [mask-image:radial-gradient(70%_60%_at_50%_40%,black,transparent)]" />
        <div className="absolute inset-0 bg-hero-glow" />
        <div className="relative flex h-full flex-col justify-end p-12">
          <p className="font-display text-4xl leading-tight text-balance">
            Every brief, cut and approval — <em className="text-brand">in one flow.</em>
          </p>
          <ul className="mt-8 grid gap-3 text-sm text-muted-foreground">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full bg-brand/15 text-brand">
                  <CheckIcon className="size-3" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
