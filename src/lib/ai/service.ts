import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { dbErrorMessage } from "@/lib/db-errors";
import { isStaff } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace";
import type { Database, Json, WorkspaceRole } from "@/types/database";
import { createAnthropicMessages, generateStructured, SCRIPT_MAX_TOKENS, type MessagesParser } from "./anthropic";
import { getAiConfig, type AiConfig } from "./config";
import { logDetails, toAiFailure, type AiFailureCode } from "./errors";
import { buildScriptUserMessage, SCRIPT_PROMPT_VERSION, SCRIPT_SYSTEM_PROMPT } from "./prompts";
import { scriptBriefSchema, scriptOutputSchema } from "./script-schema";

/** Thinking depth for scripts on the default model (Claude Sonnet 5.5): a balance of quality and cost. */
const SCRIPT_EFFORT = "medium" as const;

export type AiRunOutcome =
  | { ok: true; generationId: string; model: string; inputTokens: number; outputTokens: number }
  | {
      ok: false;
      code: AiFailureCode | "forbidden" | "invalid_input" | "start_failed" | "not_saved";
      message: string;
      fieldErrors?: Record<string, string[]>;
      /** Set once a generation record exists (it then shows as failed). */
      generationId?: string;
    };

type Db = SupabaseClient<Database>;

/** Everything the run depends on; the defaults are the real implementations. */
export type AiServiceDeps = {
  context: () => Promise<{ userId: string; workspaceId: string; role: WorkspaceRole }>;
  /** Supabase as the signed-in user (RLS and the database's limits apply). */
  userDb: () => Promise<Db>;
  /** Supabase with the server's secret key: only used to record results via finish_ai_run(). */
  adminDb: () => Db;
  config: () => AiConfig;
  messages: (apiKey: string) => MessagesParser;
};

const defaultDeps: AiServiceDeps = {
  context: async () => {
    const { user, active } = await getWorkspaceContext();
    return { userId: user.id, workspaceId: active.id, role: active.role };
  },
  userDb: createClient,
  adminDb: createAdminClient,
  config: getAiConfig,
  messages: createAnthropicMessages,
};

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string[]> = {};
  for (const issue of issues) (out[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
  return out;
}

/**
 * Generates a script for the active workspace: checks the user is staff,
 * validates the brief, reserves the run with start_ai_generation() (the
 * database checks membership and the workspace/user limits), calls Claude on
 * the server, and records the outcome with finish_ai_run() using the secret
 * key. Every outcome is recorded; nothing is shown to the user that the
 * model didn't produce.
 */
export async function generateScript(input: unknown, deps: AiServiceDeps = defaultDeps): Promise<AiRunOutcome> {
  const ctx = await deps.context();
  if (!isStaff(ctx.role)) {
    return { ok: false, code: "forbidden", message: "Only the team can use AI Studio." };
  }

  const parsed = scriptBriefSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_input",
      message: "Check the highlighted fields.",
      fieldErrors: fieldErrors(parsed.error.issues),
    };
  }
  const brief = parsed.data;

  const config = deps.config();
  if (!config.configured) {
    return { ok: false, code: "not_configured", message: config.message };
  }

  const userMessage = buildScriptUserMessage(brief);
  const db = await deps.userDb();
  const { data: started, error: startError } = await db.rpc("start_ai_generation", {
    p_workspace: ctx.workspaceId,
    p_kind: "script",
    p_prompt: userMessage,
    p_input: {
      promptVersion: SCRIPT_PROMPT_VERSION,
      durationSeconds: brief.durationSeconds,
      audience: brief.audience ?? null,
      tone: brief.tone ?? null,
      platform: brief.platform ?? null,
      callToAction: brief.callToAction ?? null,
    } satisfies Json,
    p_title: brief.title ?? null,
    p_project: brief.projectId ?? null,
  });
  if (startError || !started?.[0]) {
    if (startError?.hint?.startsWith("ai_limit")) {
      return { ok: false, code: "limit_reached", message: startError.message };
    }
    return {
      ok: false,
      code: "start_failed",
      message: dbErrorMessage(startError, "Couldn't start the generation. Please try again."),
    };
  }
  const { generation_id: generationId, usage_event_id: eventId } = started[0];

  let finish: Database["public"]["Functions"]["finish_ai_run"]["Args"];
  let outcome: AiRunOutcome;
  try {
    const result = await generateStructured(deps.messages(config.apiKey), {
      model: config.model,
      system: SCRIPT_SYSTEM_PROMPT,
      user: userMessage,
      schema: scriptOutputSchema,
      maxTokens: SCRIPT_MAX_TOKENS,
      effort: SCRIPT_EFFORT,
    });
    finish = {
      p_event: eventId,
      p_succeeded: true,
      p_model: result.model,
      p_input_tokens: result.usage.inputTokens,
      p_output_tokens: result.usage.outputTokens,
      p_output: result.data as Json,
    };
    outcome = {
      ok: true,
      generationId,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    };
  } catch (error) {
    const failure = toAiFailure(error);
    console.error("[ai] script generation failed", { generationId, code: failure.code, ...logDetails(error) });
    finish = { p_event: eventId, p_succeeded: false, p_model: config.model, p_error: failure.message };
    outcome = { ok: false, code: failure.code, message: failure.message, generationId };
  }

  const { error: finishError } = await deps.adminDb().rpc("finish_ai_run", finish);
  if (finishError) {
    console.error("[ai] couldn't record the AI result", { generationId, code: finishError.code });
    return {
      ok: false,
      code: "not_saved",
      message: "The result couldn't be saved. Please try again in a moment.",
      generationId,
    };
  }
  return outcome;
}
