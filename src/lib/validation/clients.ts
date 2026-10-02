import { z } from "zod";
import { optionalText } from "./common";

const optionalEmail = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address")).optional(),
);

export const clientSchema = z.object({
  name: z.string().trim().min(1, "Enter the client's name").max(120, "Name is too long"),
  company: optionalText(120, "Company"),
  email: optionalEmail,
  phone: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      .max(40, "Phone number is too long")
      .regex(/^[0-9+()\-.\s]+$/, "Use digits, spaces and + ( ) - only")
      .optional(),
  ),
  notes: optionalText(5000, "Notes"),
});

export const updateClientSchema = clientSchema.extend({ clientId: z.uuid() });
export const clientIdSchema = z.object({ clientId: z.uuid() });
