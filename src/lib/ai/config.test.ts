import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "AI_PROVIDER",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

/** Reloads the config with the given environment (serverEnv is read at import time). */
async function configWith(env: Record<string, string>) {
  vi.resetModules();
  for (const key of ENV_KEYS) vi.stubEnv(key, env[key] ?? "");
  return import("./config");
}

const SECRET = { SUPABASE_SECRET_KEY: "test-secret" };

describe("getAiConfig: provider selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses Gemini when AI_PROVIDER isn't set, even if an Anthropic key is present", async () => {
    const c = await configWith({ ...SECRET, ANTHROPIC_API_KEY: "anthropic-key" });
    expect(c.DEFAULT_AI_PROVIDER).toBe("gemini");
    // No Gemini key: not configured, and never a fallback to the paid provider.
    expect(c.getAiConfig()).toMatchObject({ configured: false, provider: "gemini", reason: "missing_api_key" });
    expect(c.isAiConfigured()).toBe(false);
  });

  it("rejects an unknown AI_PROVIDER", async () => {
    const c = await configWith({ ...SECRET, AI_PROVIDER: "openai", GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-x" });
    expect(c.getAiConfig()).toMatchObject({ configured: false, provider: null, reason: "invalid_provider" });
  });

  it("accepts the provider name in any case", async () => {
    const c = await configWith({ ...SECRET, AI_PROVIDER: " Gemini ", GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-x1" });
    expect(c.getAiConfig()).toMatchObject({ configured: true, provider: "gemini" });
  });
});

describe("getAiConfig: Gemini", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses GEMINI_API_KEY and GEMINI_MODEL", async () => {
    const c = await configWith({ ...SECRET, GEMINI_API_KEY: "gemini-key", GEMINI_MODEL: " gemini-test-flash " });
    expect(c.getAiConfig()).toEqual({
      configured: true,
      provider: "gemini",
      apiKey: "gemini-key",
      model: "gemini-test-flash",
    });
  });

  it("has no default model: GEMINI_MODEL must be chosen explicitly", async () => {
    const c = await configWith({ ...SECRET, GEMINI_API_KEY: "gemini-key" });
    const config = c.getAiConfig();
    expect(config).toMatchObject({ configured: false, reason: "missing_model" });
    expect(JSON.stringify(config)).not.toContain("gemini-key");
  });

  it("rejects model codes that aren't Gemini models", async () => {
    for (const GEMINI_MODEL of [
      "claude-sonnet-5-5",
      "gemini-",
      "Gemini-Flash",
      "gemini flash",
      `gemini-${"x".repeat(90)}`,
    ]) {
      const c = await configWith({ ...SECRET, GEMINI_API_KEY: "gemini-key", GEMINI_MODEL });
      expect(c.getAiConfig()).toMatchObject({ configured: false, reason: "invalid_model" });
    }
  });

  it("needs the Supabase secret key", async () => {
    const c = await configWith({ GEMINI_API_KEY: "gemini-key", GEMINI_MODEL: "gemini-x1" });
    expect(c.getAiConfig()).toMatchObject({ configured: false, reason: "missing_secret_key" });
  });

  it("gives the UI a status without the key", async () => {
    const c = await configWith({ ...SECRET, GEMINI_API_KEY: "gemini-key", GEMINI_MODEL: "gemini-x1" });
    const status = c.getAiStatus();
    expect(status).toMatchObject({ configured: true, providerLabel: "Google Gemini", message: null });
    expect(status.dataNote).toMatch(/free tier/);
    expect(JSON.stringify(status)).not.toContain("gemini-key");

    const missing = await configWith({ ...SECRET });
    expect(missing.getAiStatus()).toMatchObject({
      configured: false,
      message: expect.stringContaining("GEMINI_API_KEY"),
    });
  });
});

describe("getAiConfig: Anthropic (AI_PROVIDER=anthropic)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const ANTHROPIC = { ...SECRET, AI_PROVIDER: "anthropic" };

  it("uses the verified default model when ANTHROPIC_MODEL isn't set", async () => {
    const { getAiConfig, DEFAULT_AI_MODEL } = await configWith({ ...ANTHROPIC, ANTHROPIC_API_KEY: "test-key" });
    expect(DEFAULT_AI_MODEL).toBe("claude-sonnet-5-5");
    expect(getAiConfig()).toEqual({
      configured: true,
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-5-5",
    });
  });

  it("uses ANTHROPIC_MODEL when it is a valid model ID", async () => {
    const { getAiConfig } = await configWith({
      ...ANTHROPIC,
      ANTHROPIC_API_KEY: "test-key",
      ANTHROPIC_MODEL: " claude-opus-5-5 ",
    });
    expect(getAiConfig()).toMatchObject({ configured: true, model: "claude-opus-5-5" });
  });

  it("reports what's missing without exposing values", async () => {
    let c = await configWith({ ...ANTHROPIC, GEMINI_API_KEY: "gemini-key", GEMINI_MODEL: "gemini-x1" });
    // A Gemini key doesn't make the Anthropic provider work.
    expect(c.getAiConfig()).toMatchObject({ configured: false, reason: "missing_api_key" });
    expect(c.isAiConfigured()).toBe(false);

    c = await configWith({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key" });
    const missingSecret = c.getAiConfig();
    expect(missingSecret).toMatchObject({ configured: false, reason: "missing_secret_key" });
    expect(JSON.stringify(missingSecret)).not.toContain("test-key");

    for (const ANTHROPIC_MODEL of [
      "gpt-5",
      "claude-",
      "Claude-Sonnet",
      "claude-sonnet 5",
      `claude-${"x".repeat(90)}`,
    ]) {
      c = await configWith({ ...ANTHROPIC, ANTHROPIC_API_KEY: "test-key", ANTHROPIC_MODEL });
      expect(c.getAiConfig()).toMatchObject({ configured: false, reason: "invalid_model" });
    }
  });
});
