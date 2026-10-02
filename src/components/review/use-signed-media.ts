"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAssetMediaUrls } from "@/lib/actions/assets";
import { refreshDelay } from "@/lib/media/url-refresh";

/** `downloadUrl` is null when downloads aren't allowed (client portal, D6). */
export type SignedMedia = { url: string; downloadUrl: string | null; expiresAt: number };

/**
 * Keeps a signed media URL fresh: renews it before expiry, and on demand
 * (e.g. when the media element reports a load error after the URL expired).
 */
export function useSignedMedia(assetId: string, initial: SignedMedia | null) {
  const [media, setMedia] = useState<SignedMedia | null>(initial);
  const [error, setError] = useState<string | null>(initial ? null : "A secure link to this file couldn't be created.");
  const inFlight = useRef<Promise<boolean> | null>(null);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      const result = await getAssetMediaUrls(assetId);
      inFlight.current = null;
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setError(null);
      setMedia({ url: result.url, downloadUrl: result.downloadUrl, expiresAt: result.expiresAt });
      return true;
    })();
    return inFlight.current;
  }, [assetId]);

  useEffect(() => {
    if (!media) return;
    const t = setTimeout(() => void refresh(), refreshDelay(media.expiresAt));
    return () => clearTimeout(t);
  }, [media, refresh]);

  return { media, error, refresh };
}
