import { describe, expect, it, vi } from "vitest";
import { generateStructured, type MessagesParser } from "./anthropic";
import { AiResponseError } from "./errors";
import { scriptOutputSchema } from "./script-schema";
import { validScript } from "./test-fixtures";

/** Test stand-in for the SDK's messages.parse (the real API is never called in unit tests). */
function fakeMessages(response: Record<string, unknown>) {
  const parse = vi.fn(async () => response);
  return { messages: { parse } as unknown as MessagesParser, parse };
}
const request = {
  model: "claude-sonnet-5-5",
  system: "system",
  user: "user",
  schema: scriptOutputSchema,
  maxTokens: 16000,
  effort: "medium" as const,
};
const ok = {
  stop_reason: "end_turn",
  parsed_output: validScript,
  model: "claude-sonnet-5-5",
  usage: { input_tokens: 812, output_tokens: 2400 },
};

describe("generateStructured", () => {
  it("sends one structured-output request and returns the validated data, model and usage", async () => {
    const { messages, parse } = fakeMessages(ok);
    await expect(generateStructured(messages, request)).resolves.toEqual({
      data: validScript,
      model: "claude-sonnet-5-5",
      usage: { inputTokens: 812, outputTokens: 2400 },
    });
    const params = (parse.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 16000,
      system: "system",
      messages: [{ role: "user", content: "user" }],
      output_config: { effort: "medium" },
    });
    expect((params.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect(params).not.toHaveProperty("fallbacks"); // D5: refusal fallback off
    expect(params).not.toHaveProperty("thinking"); // adaptive thinking is the model default
  });

  it.each([
    [{ ...ok, stop_reason: "refusal", parsed_output: null }, "refused"],
    [{ ...ok, stop_reason: "max_tokens" }, "truncated"],
    [{ ...ok, parsed_output: null }, "invalid_output"],
    [{ ...ok, parsed_output: { ...validScript, scenes: [] } }, "invalid_output"],
  ])("rejects an unusable response (%#) as %s", async (response, code) => {
    const { messages } = fakeMessages(response);
    const error = await generateStructured(messages, request).catch((e) => e);
    expect(error).toBeInstanceOf(AiResponseError);
    expect(error.code).toBe(code);
  });
});
