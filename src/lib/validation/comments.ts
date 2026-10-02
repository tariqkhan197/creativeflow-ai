import { z } from "zod";
import { COMMENT_MAX_LENGTH } from "@/lib/review/threads";

const body = z
  .string()
  .trim()
  .min(1, "Write a comment first")
  .max(COMMENT_MAX_LENGTH, `Comments can be at most ${COMMENT_MAX_LENGTH} characters`);

export const annotationSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();

export const addCommentSchema = z.object({
  assetId: z.uuid(),
  body,
  timestampSeconds: z
    .number()
    .finite()
    .min(0)
    .max(60 * 60 * 24 * 7)
    .nullable()
    .default(null),
  annotation: annotationSchema.nullable().default(null),
  isInternal: z.boolean().default(false),
});

export const replySchema = z.object({ parentId: z.uuid(), body, isInternal: z.boolean().default(false) });
export const editCommentSchema = z.object({ commentId: z.uuid(), body });
export const commentIdSchema = z.object({ commentId: z.uuid() });
export const resolveCommentSchema = z.object({ commentId: z.uuid(), resolved: z.boolean() });

/** Client-side check mirroring the database rule (timestamp ≤ duration + 0.5 s). */
export function timestampError(seconds: number | null, duration: number | null): string | null {
  if (seconds === null || duration === null) return null;
  return seconds > duration + 0.5 ? "That position is past the end of the media." : null;
}
