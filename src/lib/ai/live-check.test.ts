import { afterEach, describe, expect, it, vi } from "vitest";
import { realLiveDeps, resolveLiveTarget, runLiveCheck, type LiveDeps } from "./live-check";
import { validScript } from "./test-fixtures";

// Fails the test if Gemini mode ever creates an Anthropic client or sends an Anthropic request.
const anthropicSdk = vi.hoisted(() => ({ create: vi.fn(), generate: vi.fn() }));
vi.mock("./anthropic", () => ({
  createAnthropicMessages: anthropicSdk.create,
  generateStructured: anthropicSdk.generate,
}));

const GEMINI_KEY = "AIzaTEST_gemini_key_value_0000000000000";
const ANTHROPIC_KEY = "sk-ant-test-anthropic-key-value-0000";

describe("resolveLiveTarget", () => {
  it("requires AI_PROVIDER to be set explicitly", () => {
    const r = resolveLiveTarget({ GEMINI_API_KEY: GEMINI_KEY, GEMINI_MODEL: "gemini-test-flash" });
    expect(r).toEqual({ ok: false, message: expect.stringContaining("AI_PROVIDER isn't set") });
  });

  it("rejects an unknown provider without echoing the value", () => {
    const r = resolveLiveTarget({ AI_PROVIDER: "sk-ant-pasted-by-mistake" });
    expect(r).toEqual({ ok: false, message: 'AI_PROVIDER must be "gemini" or "anthropic".' });
  });

  it("selects Gemini with its key and model, even when an Anthropic key is present", () => {
    const r = resolveLiveTarget({
      AI_PROVIDER: " Gemini ",
      GEMINI_API_KEY: GEMINI_KEY,
      GEMINI_MODEL: "gemini-test-flash",
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
    });
    expect(r).toEqual({ ok: true, target: { provider: "gemini", apiKey: GEMINI_KEY, model: "gemini-test-flash" } });
  });

  it("names the missing Gemini settings, never their values", () => {
    const both = resolveLiveTarget({ AI_PROVIDER: "gemini", ANTHROPIC_API_KEY: ANTHROPIC_KEY });
    expect(both).toEqual({
      ok: false,
      message: 'AI_PROVIDER is "gemini" but GEMINI_API_KEY and GEMINI_MODEL aren\'t set.',
    });
    const model = resolveLiveTarget({ AI_PROVIDER: "gemini", GEMINI_API_KEY: GEMINI_KEY });
    expect(model).toMatchObject({ ok: false, message: expect.stringContaining("GEMINI_MODEL isn't set") });
    const key = resolveLiveTarget({ AI_PROVIDER: "gemini", GEMINI_MODEL: "gemini-test-flash", GEMINI_API_KEY: "  " });
    expect(key).toMatchObject({ ok: false, message: expect.stringContaining("GEMINI_API_KEY isn't set") });
    const invalid = resolveLiveTarget({ AI_PROVIDER: "gemini", GEMINI_API_KEY: GEMINI_KEY, GEMINI_MODEL: "claude-x" });
    expect(invalid).toMatchObject({ ok: false, message: expect.stringContaining("isn't a valid Gemini model") });
    for (const r of [both, model, key, invalid]) {
      expect(JSON.stringify(r)).not.toContain(GEMINI_KEY);
      expect(JSON.stringify(r)).not.toContain(ANTHROPIC_KEY);
    }
  });

  it("selects Anthropic only when AI_PROVIDER is anthropic, with its default model", () => {
    expect(resolveLiveTarget({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: ANTHROPIC_KEY })).toEqual({
      ok: true,
      target: { provider: "anthropic", apiKey: ANTHROPIC_KEY, model: "claude-sonnet-5-5" },
    });
    const missing = resolveLiveTarget({ AI_PROVIDER: "anthropic", GEMINI_API_KEY: GEMINI_KEY });
    expect(missing).toEqual({ ok: false, message: 'AI_PROVIDER is "anthropic" but ANTHROPIC_API_KEY isn\'t set.' });
  });
});

describe("runLiveCheck", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    anthropicSdk.create.mockReset();
    anthropicSdk.generate.mockReset();
  });

  const fakeDeps = () => {
    const result = { data: validScript, model: "m", usage: { inputTokens: 1, outputTokens: 2 } };
    const gemini = vi.fn(async () => vi.fn(async () => result));
    const anthropic = vi.fn(async () => vi.fn(async () => result));
    return { deps: { gemini, anthropic } as unknown as LiveDeps, gemini, anthropic };
  };

  it("dispatches to the selected provider only", async () => {
    const g = fakeDeps();
    await runLiveCheck({ provider: "gemini", apiKey: GEMINI_KEY, model: "gemini-test-flash" }, g.deps);
    expect(g.gemini).toHaveBeenCalledWith(GEMINI_KEY);
    expect(g.anthropic).not.toHaveBeenCalled();

    const a = fakeDeps();
    await runLiveCheck({ provider: "anthropic", apiKey: ANTHROPIC_KEY, model: "claude-sonnet-5-5" }, a.deps);
    expect(a.anthropic).toHaveBeenCalledWith(ANTHROPIC_KEY);
    expect(a.gemini).not.toHaveBeenCalled();
  });

  it("in Gemini mode, sends requests only to the Gemini API (real SDK, stubbed network)", async () => {
    const requests: { url: string; headers: Headers }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        requests.push({ url: String(url), headers: new Headers(init?.headers) });
        return new Response(
          JSON.stringify({
            candidates: [
              { content: { role: "model", parts: [{ text: JSON.stringify(validScript) }] }, finishReason: "STOP" },
            ],
            modelVersion: "gemini-test-flash-001",
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 400, thoughtsTokenCount: 100 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const result = await runLiveCheck({ provider: "gemini", apiKey: GEMINI_KEY, model: "gemini-test-flash" });

    expect(result).toMatchObject({ model: "gemini-test-flash-001", usage: { inputTokens: 50, outputTokens: 500 } });
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).hostname).toBe("generativelanguage.googleapis.com");
    expect(requests[0].url).toContain("models/gemini-test-flash:generateContent");
    // The key travels in a header, not the URL (URLs end up in logs).
    expect(requests[0].url).not.toContain(GEMINI_KEY);
    expect(requests[0].headers.get("x-goog-api-key")).toBe(GEMINI_KEY);
    expect(requests.some((r) => r.url.includes("anthropic"))).toBe(false);
    expect(anthropicSdk.create).not.toHaveBeenCalled();
    expect(anthropicSdk.generate).not.toHaveBeenCalled();
  });

  it("reports a Gemini quota error with the app's safe message, never the key or raw response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 429,
                status: "RESOURCE_EXHAUSTED",
                message: "Quota exceeded (raw upstream detail)",
                details: [
                  {
                    "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                    violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }],
                  },
                ],
              },
            }),
            { status: 429, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const error = await runLiveCheck({ provider: "gemini", apiKey: GEMINI_KEY, model: "gemini-test-flash" }).then(
      () => new Error("expected the live check to fail"),
      (e: unknown) => e as Error,
    );

    expect(error.message).toMatch(/^Live Gemini request failed \(quota_exceeded\): The free Gemini quota for today/);
    expect(error.message).not.toContain(GEMINI_KEY);
    expect(error.message).not.toContain("raw upstream detail");
    expect(anthropicSdk.create).not.toHaveBeenCalled();
  });

  it("creates real clients only for the chosen provider", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await realLiveDeps.gemini(GEMINI_KEY);
    expect(anthropicSdk.create).not.toHaveBeenCalled();
    await realLiveDeps.anthropic(ANTHROPIC_KEY);
    expect(anthropicSdk.create).toHaveBeenCalledWith(ANTHROPIC_KEY);
  });
});
