/** Renew signed URLs this long before they expire. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Delay until a signed URL should be renewed (never negative, at least 10 s). */
export function refreshDelay(expiresAt: number, now = Date.now()): number {
  return Math.max(10_000, expiresAt - now - REFRESH_MARGIN_MS);
}

/** At most one automatic refresh per window; a repeat failure is a real problem. */
export const AUTO_REFRESH_WINDOW_MS = 30_000;

export function shouldAutoRefresh(lastAutoRefreshAt: number | null, now = Date.now()): boolean {
  return lastAutoRefreshAt === null || now - lastAutoRefreshAt > AUTO_REFRESH_WINDOW_MS;
}
