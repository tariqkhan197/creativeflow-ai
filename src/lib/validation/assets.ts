import { z } from "zod";

const positiveOptional = (max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().finite().positive().max(max).optional(),
  );

export const createAssetUploadSchema = z.object({
  projectId: z.uuid(),
  fileName: z.string().trim().min(1, "The file needs a name").max(1000),
  size: z.coerce.number().int().positive("This file is empty").max(Number.MAX_SAFE_INTEGER),
  browserMime: z.string().trim().max(200).optional().default(""),
  /** Set when uploading a new version of an existing original. */
  rootAssetId: z.uuid().optional(),
});

/** Metadata measured in the browser from the actual file; anything unknown is omitted. */
export const finalizeAssetSchema = z.object({
  assetId: z.uuid(),
  durationSeconds: positiveOptional(60 * 60 * 24 * 7),
  width: positiveOptional(100_000),
  height: positiveOptional(100_000),
  frameRate: positiveOptional(1000),
});

export const assetIdSchema = z.object({ assetId: z.uuid() });

export const uploadFailureSchema = z.object({
  assetId: z.uuid(),
  message: z.string().trim().min(1).max(500),
});

export const renameAssetSchema = z.object({
  assetId: z.uuid(),
  name: z.string().trim().min(1, "Enter a name").max(255, "Name is too long"),
});

export const deleteAssetSchema = z.object({ assetId: z.uuid(), scope: z.enum(["version", "all"]) });
