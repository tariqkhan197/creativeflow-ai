import Link from "next/link";
import { AlertTriangleIcon, RotateCwIcon } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

/**
 * Branded "something went wrong" screen for the root error boundaries. It
 * never shows the error message (server errors only expose a digest, which is
 * shown as a reference to match the server logs).
 */
export function ErrorView({ digest, onRetry }: { digest?: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-svh place-items-center bg-background px-4 text-foreground">
      <div className="grid max-w-md justify-items-center gap-6 text-center">
        <Logo />
        <span className="inline-flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangleIcon className="size-5" />
        </span>
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load this page. Check your connection and try again. If it keeps happening, contact support
            and quote the reference below.
          </p>
          {digest ? <p className="font-mono text-xs text-muted-foreground">Reference: {digest}</p> : null}
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="brand" onClick={onRetry}>
            <RotateCwIcon /> Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
