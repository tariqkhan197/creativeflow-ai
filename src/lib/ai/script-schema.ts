import { z } from "zod";
import { optionalText, optionalUuid } from "@/lib/validation/common";

/** What someone asks AI Studio for (validated before anything is sent to the model). */
export const scriptBriefSchema = z.object({
  title: optionalText(200, "Title"),
  projectId: optionalUuid,
  brief: z
    .string()
    .trim()
    .min(20, "Describe the brief in at least a sentence or two")
    .max(4000, "The brief is too long (4,000 characters max)"),
  audience: optionalText(300, "Audience"),
  tone: optionalText(100, "Tone"),
  durationSeconds: z.coerce
    .number("Enter a duration in seconds")
    .int("Use whole seconds")
    .min(5, "At least 5 seconds")
    .max(600, "At most 10 minutes"),
  platform: optionalText(100, "Platform"),
  callToAction: optionalText(200, "Call to action"),
});
export type ScriptBrief = z.infer<typeof scriptBriefSchema>;

/**
 * The script the model must return. Structured outputs guarantee the shape;
 * the length and number limits below are checked again by the SDK and by
 * us, because the API doesn't enforce them.
 */
export const scriptOutputSchema = z.object({
  title: z.string().min(1).max(200),
  logline: z.string().min(1).max(500),
  totalSeconds: z.number().int().min(1).max(900),
  scenes: z
    .array(
      z.object({
        heading: z.string().min(1).max(120),
        seconds: z.number().int().min(1).max(600),
        visuals: z.string().min(1).max(1500),
        voiceover: z.string().max(1500).nullable(),
        dialogue: z.array(z.object({ speaker: z.string().min(1).max(60), line: z.string().min(1).max(600) })).max(20),
        onScreenText: z.string().max(300).nullable(),
        audio: z.string().max(500).nullable(),
      }),
    )
    .min(1)
    .max(40),
});
export type ScriptOutput = z.infer<typeof scriptOutputSchema>;
