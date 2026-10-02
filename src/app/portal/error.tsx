"use client";

import { useEffect } from "react";
import { AlertTriangleIcon, RotateCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="grid justify-items-center gap-4 rounded-xl border px-6 py-16 text-center">
      <span className="inline-flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangleIcon className="size-5" />
      </span>
      <div className="grid gap-1">
        <h2 className="font-semibold">Something went wrong</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          We couldn&apos;t load this page. Check your connection and try again.
          {error.digest ? <span className="mt-2 block font-mono text-xs">Reference: {error.digest}</span> : null}
        </p>
      </div>
      <Button variant="outline" onClick={reset}>
        <RotateCwIcon /> Try again
      </Button>
    </div>
  );
}
