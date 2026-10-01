import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="grid gap-2">
          <Logo />
          <p className="text-sm text-muted-foreground">The operating system for agencies and creative teams.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link href="/#features" className="hover:text-foreground">
            Features
          </Link>
          <Link href="/#security" className="hover:text-foreground">
            Security
          </Link>
          <Link href="/login" className="hover:text-foreground">
            Sign in
          </Link>
          <Link href="/signup" className="hover:text-foreground">
            Create account
          </Link>
        </nav>
      </div>
      <div className="border-t">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground sm:px-6">
          © {new Date().getFullYear()} CreativeFlow AI. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
