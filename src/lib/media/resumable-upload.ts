import * as tus from "tus-js-client";
import type { UploadTarget } from "@/lib/actions/assets";
import { RESUMABLE_CHUNK_SIZE } from "@/lib/media/file-types";
import { describeUploadError } from "@/lib/media/upload-errors";

export type ResumableCallbacks = {
  onProgress: (bytesSent: number, bytesTotal: number) => void;
  onSuccess: () => void;
  onError: (message: string, retryable: boolean) => void;
};

export type ResumableUpload = {
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => void;
  cancel: () => Promise<void>;
};

/**
 * Direct browser → Supabase Storage resumable (TUS) upload, authenticated as
 * the signed-in user so Storage RLS applies. Only the publishable key and the
 * user's own access token are used — never a secret key.
 */
export function createResumableUpload(
  file: File,
  target: UploadTarget,
  auth: { publishableKey: string; getAccessToken: () => Promise<string | null> },
  callbacks: ResumableCallbacks,
): ResumableUpload {
  const upload = new tus.Upload(file, {
    endpoint: target.endpoint,
    chunkSize: RESUMABLE_CHUNK_SIZE,
    retryDelays: [0, 2000, 5000, 10000, 20000],
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    headers: {
      apikey: auth.publishableKey,
      // Allowed by RLS only while this user's asset is still uploading; lets a
      // retried upload replace a partial object. Completed files can't be overwritten.
      "x-upsert": "true",
    },
    metadata: {
      bucketName: target.bucket,
      objectName: target.objectName,
      contentType: target.contentType,
      cacheControl: "3600",
    },
    // Stable per asset + file, so a retry resumes the same server-side upload.
    fingerprint: async (f) => `creativeflow:${target.assetId}:${(f as File).size}:${(f as File).lastModified}`,
    onBeforeRequest: async (req) => {
      const token = await auth.getAccessToken();
      if (token) req.setHeader("Authorization", `Bearer ${token}`);
    },
    onProgress: (sent, total) => callbacks.onProgress(sent, total),
    onSuccess: () => callbacks.onSuccess(),
    onError: (error) => {
      const detailed = error as tus.DetailedError;
      const status = detailed.originalResponse?.getStatus?.() ?? null;
      const body = detailed.originalResponse?.getBody?.() ?? "";
      const { message, retryable } = describeUploadError(status, body);
      callbacks.onError(message, retryable);
    },
  });

  return {
    async start() {
      const previous = await upload.findPreviousUploads();
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    },
    pause: () => upload.abort(false),
    resume: () => upload.start(),
    async cancel() {
      try {
        await upload.abort(true);
      } catch {
        // The partial upload is also removed server-side by cancelAssetUpload.
      }
    },
  };
}
