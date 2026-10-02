// Test seam for tests/browser: the real getAssetMediaUrls is a Server Action
// (Next.js + Supabase). This stub returns the page's current test source so
// the viewer's refresh/reload paths run in a plain browser. `__downloadsOff`
// mimics a client project with downloads turned off (no download URL).
type HarnessWindow = Window & { __currentSrc?: string; __refreshes?: number; __downloadsOff?: boolean };

export async function getAssetMediaUrls(assetId: string) {
  void assetId;
  const w = window as HarnessWindow;
  w.__refreshes = (w.__refreshes ?? 0) + 1;
  const url = w.__currentSrc ?? "";
  return { ok: true as const, url, downloadUrl: w.__downloadsOff ? null : url, expiresAt: Date.now() + 3_600_000 };
}
