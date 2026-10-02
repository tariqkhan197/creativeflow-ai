import type { AssetKind } from "@/types/database";

/**
 * Supported upload types. MUST stay in sync with private.asset_kind_for_mime()
 * and the bucket's allowed_mime_types (migration 20261003000000); a unit test
 * compares this list against the migration file.
 */
export type FileTypeInfo = {
  mime: string;
  kind: AssetKind;
  extensions: string[];
  label: string;
};

export const FILE_TYPES: FileTypeInfo[] = [
  { mime: "video/mp4", kind: "video", extensions: ["mp4"], label: "MP4 video" },
  { mime: "video/quicktime", kind: "video", extensions: ["mov", "qt"], label: "QuickTime video" },
  { mime: "video/webm", kind: "video", extensions: ["webm"], label: "WebM video" },
  { mime: "video/x-matroska", kind: "video", extensions: ["mkv"], label: "Matroska video" },
  { mime: "video/x-m4v", kind: "video", extensions: ["m4v"], label: "M4V video" },
  { mime: "video/x-msvideo", kind: "video", extensions: ["avi"], label: "AVI video" },
  { mime: "image/jpeg", kind: "image", extensions: ["jpg", "jpeg"], label: "JPEG image" },
  { mime: "image/png", kind: "image", extensions: ["png"], label: "PNG image" },
  { mime: "image/webp", kind: "image", extensions: ["webp"], label: "WebP image" },
  { mime: "image/gif", kind: "image", extensions: ["gif"], label: "GIF image" },
  { mime: "image/avif", kind: "image", extensions: ["avif"], label: "AVIF image" },
  { mime: "image/tiff", kind: "image", extensions: ["tif", "tiff"], label: "TIFF image" },
  { mime: "audio/mpeg", kind: "audio", extensions: ["mp3"], label: "MP3 audio" },
  { mime: "audio/wav", kind: "audio", extensions: ["wav"], label: "WAV audio" },
  { mime: "audio/x-wav", kind: "audio", extensions: [], label: "WAV audio" },
  { mime: "audio/mp4", kind: "audio", extensions: ["m4a"], label: "M4A audio" },
  { mime: "audio/aac", kind: "audio", extensions: ["aac"], label: "AAC audio" },
  { mime: "audio/ogg", kind: "audio", extensions: ["ogg", "oga"], label: "Ogg audio" },
  { mime: "audio/flac", kind: "audio", extensions: ["flac"], label: "FLAC audio" },
  { mime: "application/pdf", kind: "document", extensions: ["pdf"], label: "PDF document" },
];

const BY_MIME = new Map(FILE_TYPES.map((t) => [t.mime, t]));
const BY_EXTENSION = new Map(FILE_TYPES.flatMap((t) => t.extensions.map((e) => [e, t] as const)));

/** Browsers report some types under alternative names; normalise them. */
const MIME_ALIASES: Record<string, string> = {
  "audio/mp3": "audio/mpeg",
  "audio/x-m4a": "audio/mp4",
  "audio/vnd.wave": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-flac": "audio/flac",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "video/x-quicktime": "video/quicktime",
};

/** All accepted extensions, for the file input's `accept` attribute. */
export const ACCEPT_ATTRIBUTE = [
  ...FILE_TYPES.map((t) => t.mime),
  ...[...BY_EXTENSION.keys()].map((e) => `.${e}`),
].join(",");

export function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

export type ResolvedFileType = { ok: true; type: FileTypeInfo } | { ok: false; error: string };

/**
 * Determines the stored MIME type from the file extension and checks it is
 * consistent with what the browser reported. The extension decides (browsers
 * often report "" or generic types), but a contradicting browser type is
 * rejected rather than silently trusted.
 */
export function resolveFileType(fileName: string, browserMime: string | undefined | null): ResolvedFileType {
  const ext = extensionOf(fileName);
  const byExt = ext ? BY_EXTENSION.get(ext) : undefined;
  if (!byExt) {
    return { ok: false, error: `“.${ext || "?"}” files aren't supported. Upload video, images, audio or PDF.` };
  }
  const reported = (browserMime ?? "").trim().toLowerCase();
  if (!reported || reported === "application/octet-stream") return { ok: true, type: byExt };
  const normalised = MIME_ALIASES[reported] ?? reported;
  const byMime = BY_MIME.get(normalised);
  if (byMime && byMime.kind === byExt.kind) return { ok: true, type: byExt };
  return { ok: false, error: `This file's contents (${reported}) don't match its .${ext} extension.` };
}

export function kindForMime(mime: string): AssetKind | null {
  return BY_MIME.get(mime)?.kind ?? null;
}

/**
 * Safe object name for Storage: ASCII letters, digits, ".", "_" and "-",
 * starting with a letter or digit, at most 200 characters, keeping the
 * extension. Must satisfy the database check in private.prepare_asset().
 */
export function sanitizeFileName(fileName: string): string {
  const ext = extensionOf(fileName);
  const base = (ext ? fileName.slice(0, -(ext.length + 1)) : fileName)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[-.]+$/, "")
    .slice(0, 180);
  const safeBase = base || "file";
  const name = ext ? `${safeBase}.${ext}` : safeBase;
  return name.toLowerCase() === "thumbnail.jpg" ? `file-${name}` : name;
}

/** Display name: the original name, trimmed to the 255-character database limit. */
export function displayName(fileName: string): string {
  const trimmed = fileName.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return (trimmed || "Untitled").slice(0, 255);
}

export function buildStoragePath(workspaceId: string, projectId: string, assetId: string, fileName: string): string {
  return `${workspaceId}/${projectId}/${assetId}/${sanitizeFileName(fileName)}`;
}

export function thumbnailPathFor(storagePath: string): string {
  return storagePath.replace(/[^/]+$/, "thumbnail.jpg");
}

/**
 * Effective upload limit: the smallest of the known limits (bucket setting,
 * optional STORAGE_MAX_UPLOAD_BYTES for the project-wide plan limit).
 * null means no limit could be determined.
 */
export function effectiveUploadLimit(...limits: (number | null | undefined)[]): number | null {
  const known = limits.filter((l): l is number => typeof l === "number" && Number.isFinite(l) && l > 0);
  return known.length ? Math.min(...known) : null;
}

export function checkFileSize(size: number, limit: number | null): string | null {
  if (!Number.isSafeInteger(size) || size <= 0) return "This file is empty.";
  if (limit !== null && size > limit) {
    return `This file is ${formatBytes(size)}, which exceeds the ${formatBytes(limit)} upload limit.`;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Supabase recommends the direct storage hostname for resumable uploads
 * (https://<ref>.storage.supabase.co). Custom domains / local URLs keep the
 * project URL.
 */
export function resumableEndpoint(supabaseUrl: string): string {
  const url = new URL(supabaseUrl);
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  const origin = match ? `https://${match[1]}.storage.supabase.co` : url.origin;
  return `${origin}/storage/v1/upload/resumable`;
}

/** Supabase requires 6 MB chunks for resumable uploads. */
export const RESUMABLE_CHUNK_SIZE = 6 * 1024 * 1024;
