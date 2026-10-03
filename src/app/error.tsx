"use client";

import { useEffect } from "react";
import { ErrorView } from "@/components/app/error-view";

/** Errors in pages outside /app and /portal (marketing, sign-in, invites, setup). */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorView digest={error.digest} onRetry={retry} />;
}
