/** Turns a resumable-upload failure into a clear message and a retry decision. */
export function describeUploadError(
  status: number | null | undefined,
  body = "",
): { message: string; retryable: boolean } {
  if (!status) {
    return {
      message: "The connection was lost. Check your network and retry — the upload resumes where it stopped.",
      retryable: true,
    };
  }
  if (status === 413 || /payload too large|exceeded the maximum allowed size|maximum size/i.test(body)) {
    return {
      message: "This file is larger than your Supabase project allows (Storage → Settings → upload file size limit).",
      retryable: false,
    };
  }
  if (status === 401 || status === 403) {
    return {
      message: "Storage refused the upload. Your session may have expired — refresh the page and retry.",
      retryable: true,
    };
  }
  if (status === 415 || /mime type|content type/i.test(body)) {
    return { message: "Storage doesn't accept this file type.", retryable: false };
  }
  if (status === 409)
    return { message: "This upload conflicts with an existing file. Retry to resume it.", retryable: true };
  if (status === 429) return { message: "Too many uploads at once. Wait a moment and retry.", retryable: true };
  if (status >= 500) return { message: "Supabase Storage had a problem. Retry in a moment.", retryable: true };
  return { message: `The upload failed (HTTP ${status}).`, retryable: true };
}
