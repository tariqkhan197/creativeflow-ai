import { z } from "zod";

export const reviewFiltersSchema = z.object({
  q: z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, 100) : undefined), z.string().optional()),
  project: z.uuid().optional().catch(undefined),
  kind: z.enum(["video", "image", "audio", "document"]).optional().catch(undefined),
  open: z.enum(["1"]).optional().catch(undefined),
  sort: z.enum(["recent", "comments", "activity"]).catch("recent").default("recent"),
});
