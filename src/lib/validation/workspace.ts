import { z } from "zod";

export const workspaceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters")
  .max(48, "Use at most 48 characters")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/, "Use lowercase letters, numbers and hyphens (not at the start or end)");

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters")
  .max(80, "Use at most 80 characters");

export const createWorkspaceSchema = z.object({
  name: workspaceNameSchema,
  slug: workspaceSlugSchema,
});

export const updateWorkspaceSchema = z.object({
  workspaceId: z.uuid(),
  name: workspaceNameSchema,
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your name").max(120, "Name is too long"),
  jobTitle: z.string().trim().max(120, "Too long").optional().default(""),
});

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}
