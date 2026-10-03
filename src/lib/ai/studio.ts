/**
 * Pure AI Studio helpers shared by Server Actions and UI (no secrets, no
 * server-only imports).
 */
import { scriptOutputSchema, type ScriptOutput } from "./script-schema";

/**
 * Mirrors private.ai_limits() in supabase/migrations/20261005000000_phase5_ai_studio.sql.
 * The database enforces these; the app only displays them.
 */
export const AI_LIMITS = { workspacePerDay: 50, userPerHour: 20, staleAfterMinutes: 15 } as const;

/** Reads a stored script document; null when it's missing or not a valid script. */
export function readScript(value: unknown): ScriptOutput | null {
  const parsed = scriptOutputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Validates an edited script and recalculates its total length from the
 * scenes. Returns field-level messages a person can act on.
 */
export function normalizeEditedScript(
  value: unknown,
): { ok: true; script: ScriptOutput } | { ok: false; errors: string[] } {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const scenes = Array.isArray(input.scenes) ? input.scenes : [];
  const totalSeconds = scenes.reduce(
    (sum: number, scene) =>
      sum + (scene && typeof scene === "object" ? Number((scene as { seconds?: unknown }).seconds) || 0 : 0),
    0,
  );
  const parsed = scriptOutputSchema.safeParse({ ...input, totalSeconds });
  if (parsed.success) return { ok: true, script: parsed.data };
  const errors = parsed.error.issues.map((issue) => {
    const [first, index, field] = issue.path;
    const where =
      first === "scenes" && typeof index === "number"
        ? `Scene ${index + 1}${typeof field === "string" ? ` (${field})` : ""}`
        : first === "totalSeconds"
          ? "Total length"
          : String(first ?? "Script");
    return `${where}: ${issue.message}`;
  });
  return { ok: false, errors: [...new Set(errors)].slice(0, 8) };
}

export type BriefDefaults = {
  title: string;
  projectId: string;
  brief: string;
  durationSeconds: string;
  audience: string;
  tone: string;
  platform: string;
  callToAction: string;
};

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Prefills the brief form from an earlier generation (to generate a new version). */
export function briefDefaultsFrom(row: {
  title: string | null;
  project_id: string | null;
  input: unknown;
}): BriefDefaults {
  const input = row.input && typeof row.input === "object" ? (row.input as Record<string, unknown>) : {};
  const seconds = Number(input.durationSeconds);
  return {
    title: row.title ?? "",
    projectId: row.project_id ?? "",
    brief: text(input.brief),
    durationSeconds: Number.isInteger(seconds) && seconds > 0 ? String(seconds) : "30",
    audience: text(input.audience),
    tone: text(input.tone),
    platform: text(input.platform),
    callToAction: text(input.callToAction),
  };
}

/** A run still pending after the timeout is treated as failed (the database marks it on the next start). */
export function isStalePending(status: string, createdAt: string, now = Date.now()): boolean {
  return status === "pending" && now - new Date(createdAt).getTime() > AI_LIMITS.staleAfterMinutes * 60_000;
}

export function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

/** Start of the windows the limits count over (the database uses the same ones). */
export function usageWindowStarts(now = Date.now()): { day: string; hour: string } {
  return {
    day: new Date(now - 24 * 3600_000).toISOString(),
    hour: new Date(now - 3600_000).toISOString(),
  };
}
