import "server-only";

import { serverEnv } from "@/lib/env/server";
import { effectiveUploadLimit } from "@/lib/media/file-types";
import type { createClient } from "@/lib/supabase/server";

export const ASSET_BUCKET = "project-assets";

/** Signed URLs for playback/download are short-lived and re-issued on demand. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type UploadLimit = {
  /** Effective limit in bytes, or null if none could be determined. */
  bytes: number | null;
  /** Where the limit came from, for honest messaging. */
  source: "bucket" | "configured" | "unknown";
};

/** The bucket limit (read from the database) combined with STORAGE_MAX_UPLOAD_BYTES. */
export async function getUploadLimit(supabase: Awaited<ReturnType<typeof createClient>>): Promise<UploadLimit> {
  const { data } = await supabase.rpc("asset_upload_constraints");
  const bucket = data?.file_size_limit ?? null;
  const configured = serverEnv.storageMaxUploadBytes;
  const bytes = effectiveUploadLimit(bucket, configured);
  const source = bytes === null ? "unknown" : configured !== null && bytes === configured ? "configured" : "bucket";
  return { bytes, source };
}
