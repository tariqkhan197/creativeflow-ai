import { describe, expect, it, vi } from "vitest";
import type { MessagesParser } from "./anthropic";
import type { AiServiceDeps } from "./service";
import { generateScript } from "./service";
import { validScript } from "./test-fixtures";

const brief = {
  brief: "A 30-second launch film for a lightweight running shoe aimed at new runners.",
  durationSeconds: "30",
  title: "First Mile",
  audience: "New runners",
};
type RpcResult = { data: unknown; error: { message: string; code?: string; hint?: string } | null };

/**
 * Test stand-ins for Supabase and the SDK. They record what the service
 * sends; the database rules themselves are tested in scripts/test-db.mjs.
 */
function setup(
  opts: {
    role?: "owner" | "member" | "client";
    configured?: boolean;
    start?: RpcResult;
    finish?: RpcResult;
    model?: () => Promise<unknown>;
  } = {},
) {
  const userRpc = vi.fn(
    async (): Promise<RpcResult> =>
      opts.start ?? { data: [{ generation_id: "gen-1", usage_event_id: "event-1" }], error: null },
  );
  const adminRpc = vi.fn(async (): Promise<RpcResult> => opts.finish ?? { data: null, error: null });
  const parse = vi.fn(
    opts.model ??
      (async () => ({
        stop_reason: "end_turn",
        parsed_output: validScript,
        model: "claude-sonnet-5-5",
        usage: { input_tokens: 900, output_tokens: 2500 },
      })),
  );
  const messagesFor = vi.fn((apiKey: string) => {
    void apiKey;
    return { parse } as unknown as MessagesParser;
  });
  const deps: AiServiceDeps = {
    context: async () => ({ userId: "user-1", workspaceId: "ws-1", role: opts.role ?? "member" }),
    userDb: async () => ({ rpc: userRpc }) as never,
    adminDb: () => ({ rpc: adminRpc }) as never,
    config: () =>
      opts.configured === false
        ? { configured: false, reason: "missing_api_key", message: "AI Studio isn't set up yet." }
        : { configured: true, apiKey: "test-key", model: "claude-sonnet-5-5" },
    messages: messagesFor,
  };
  return { deps, userRpc, adminRpc, parse, messagesFor };
}

describe("generateScript", () => {
  it("reserves the run as the user, calls the model, and records the result with the server key", async () => {
    const t = setup();
    await expect(generateScript(brief, t.deps)).resolves.toEqual({
      ok: true,
      generationId: "gen-1",
      model: "claude-sonnet-5-5",
      inputTokens: 900,
      outputTokens: 2500,
    });
    expect(t.userRpc).toHaveBeenCalledWith(
      "start_ai_generation",
      expect.objectContaining({
        p_workspace: "ws-1",
        p_kind: "script",
        p_title: "First Mile",
        p_project: null,
        p_input: expect.objectContaining({ promptVersion: "script-v1", durationSeconds: 30, audience: "New runners" }),
      }),
    );
    expect(t.messagesFor).toHaveBeenCalledWith("test-key");
    expect(t.adminRpc).toHaveBeenCalledWith("finish_ai_run", {
      p_event: "event-1",
      p_succeeded: true,
      p_model: "claude-sonnet-5-5",
      p_input_tokens: 900,
      p_output_tokens: 2500,
      p_output: validScript,
    });
    // The prompt stored with the generation is exactly what the model received.
    const stored = (t.userRpc.mock.calls[0] as unknown[])[1] as { p_prompt: string };
    const sent = (t.parse.mock.calls[0] as unknown[])[0] as { messages: { content: string }[] };
    expect(sent.messages[0].content).toBe(stored.p_prompt);
  });

  it("refuses clients before touching the database or the model", async () => {
    const t = setup({ role: "client" });
    await expect(generateScript(brief, t.deps)).resolves.toMatchObject({ ok: false, code: "forbidden" });
    expect(t.userRpc).not.toHaveBeenCalled();
    expect(t.parse).not.toHaveBeenCalled();
  });

  it("returns field errors for an invalid brief and reserves nothing", async () => {
    const t = setup();
    const outcome = await generateScript({ ...brief, durationSeconds: "2" }, t.deps);
    expect(outcome).toMatchObject({ ok: false, code: "invalid_input" });
    expect(outcome.ok === false && outcome.fieldErrors?.durationSeconds?.length).toBeTruthy();
    expect(t.userRpc).not.toHaveBeenCalled();
  });

  it("says AI isn't configured without reserving a run (nothing counts toward the limits)", async () => {
    const t = setup({ configured: false });
    await expect(generateScript(brief, t.deps)).resolves.toEqual({
      ok: false,
      code: "not_configured",
      message: "AI Studio isn't set up yet.",
    });
    expect(t.userRpc).not.toHaveBeenCalled();
    expect(t.parse).not.toHaveBeenCalled();
  });

  it("reports the database's limit message and doesn't call the model", async () => {
    const message = "This workspace has reached its limit of 50 AI generations in 24 hours. Please try again later.";
    const t = setup({ start: { data: null, error: { message, code: "P0001", hint: "ai_limit_workspace" } } });
    await expect(generateScript(brief, t.deps)).resolves.toEqual({ ok: false, code: "limit_reached", message });
    expect(t.parse).not.toHaveBeenCalled();
    expect(t.adminRpc).not.toHaveBeenCalled();
  });

  it("maps other start errors to safe messages", async () => {
    const t = setup({ start: { data: null, error: { message: "Workspace not found", code: "42501" } } });
    await expect(generateScript(brief, t.deps)).resolves.toMatchObject({
      ok: false,
      code: "start_failed",
      message: "Workspace not found",
    });
    const hidden = setup({ start: { data: null, error: { message: "relation x does not exist", code: "42P01" } } });
    await expect(generateScript(brief, hidden.deps)).resolves.toMatchObject({
      message: "Couldn't start the generation. Please try again.",
    });
  });

  it("records a failed run with a safe message when the model call fails", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const t = setup({
      model: async () => {
        throw Anthropic.APIError.generate(
          529,
          { error: { message: "Overloaded (internal detail)" } },
          undefined,
          new Headers(),
        );
      },
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await generateScript(brief, t.deps);
    expect(outcome).toMatchObject({ ok: false, code: "overloaded", generationId: "gen-1" });
    const finish = (t.adminRpc.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(finish).toMatchObject({ p_event: "event-1", p_succeeded: false, p_model: "claude-sonnet-5-5" });
    expect(String(finish.p_error)).not.toContain("internal detail");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("test-key");
    errorLog.mockRestore();
  });

  it("records a refusal as a failed run", async () => {
    const t = setup({
      model: async () => ({ stop_reason: "refusal", parsed_output: null, model: "claude-sonnet-5-5", usage: {} }),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(generateScript(brief, t.deps)).resolves.toMatchObject({ ok: false, code: "refused" });
    expect((t.adminRpc.mock.calls[0] as unknown[])[1]).toMatchObject({ p_succeeded: false });
    vi.restoreAllMocks();
  });

  it("tells the user when the result couldn't be saved", async () => {
    const t = setup({ finish: { data: null, error: { message: "db down", code: "08006" } } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(generateScript(brief, t.deps)).resolves.toEqual({
      ok: false,
      code: "not_saved",
      message: "The result couldn't be saved. Please try again in a moment.",
      generationId: "gen-1",
    });
    vi.restoreAllMocks();
  });
});
