import { z } from "zod";

/** Form inputs send "" for empty fields; treat that as "not provided". */
export const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const optionalText = (max: number, label = "This field") =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max, `${label} is too long`).optional());

export const optionalUuid = z.preprocess(emptyToUndefined, z.uuid("Invalid selection").optional());

/** YYYY-MM-DD from <input type="date">. */
export const optionalDate = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Enter a valid date")
    .optional(),
);

/**
 * Parses a human money amount ("1,500", "1500.5", "$ 2,000.00") into integer
 * cents. Returns null for an invalid amount.
 */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[\s,$€£]/g, "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export const optionalMoneyCents = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .transform((v, ctx) => {
      const cents = parseMoneyToCents(v);
      if (cents === null) {
        ctx.addIssue({ code: "custom", message: "Enter an amount like 2500 or 2,500.00" });
        return z.NEVER;
      }
      return cents;
    })
    .optional(),
);

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code");

/** Page number from a search param (1-based, clamped). */
export function parsePage(value: unknown): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : 1;
}

/**
 * Builds a PostgREST `or=(...)` filter that matches `term` case-insensitively
 * in any of `columns`. The value is double-quoted so punctuation such as "."
 * or "," is searched literally; `"` and `\` (which would break the quoting)
 * are dropped. LIKE wildcards typed by the user only broaden the match, and
 * RLS still limits rows to the caller's workspace.
 */
export function ilikeAny(columns: string[], term: string): string {
  const safe = term.trim().slice(0, 100).replace(/["\\]/g, "");
  return columns.map((c) => `${c}.ilike."%${safe}%"`).join(",");
}
