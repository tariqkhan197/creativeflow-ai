import type { z } from "zod";

export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Echoed values so inputs keep their content after a failed submit. */
  values?: Record<string, string>;
  /** Extra result data for the client (e.g. a one-time invite link). */
  data?: Record<string, string>;
};

/** Result of a non-form Server Action (buttons, selects). */
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export const initialFormState: FormState = { status: "idle" };

export function fieldErrorsFrom(error: z.ZodError): FormState["fieldErrors"] {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Plain string values from FormData, excluding sensitive fields. */
export function echoValues(formData: FormData, omit: string[] = ["password", "confirmPassword"]) {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !omit.includes(key) && !key.startsWith("$")) values[key] = value;
  }
  return values;
}
