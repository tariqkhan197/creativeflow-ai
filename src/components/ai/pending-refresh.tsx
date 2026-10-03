"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * While a generation is still running (for example started in another tab),
 * re-checks it every 10 seconds, for at most 16 minutes (the database marks
 * runs older than 15 minutes as failed).
 */
export function PendingRefresh() {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 16 * 60_000) clearInterval(timer);
      else router.refresh();
    }, 10_000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
