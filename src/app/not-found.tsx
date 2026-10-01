import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-svh place-items-center px-4">
      <div className="grid justify-items-center gap-6 text-center">
        <Logo />
        <div className="grid gap-2">
          <p className="font-mono text-sm text-brand">404</p>
          <h1 className="text-2xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
          <p className="text-sm text-muted-foreground">The link may be broken, or the page may have been moved.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
