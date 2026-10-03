import { afterEach, describe, expect, it, vi } from "vitest";

/** Reloads the config with the given environment (serverEnv is read at import time). */
async function configWith(env: Record<string, string>) {
  vi.resetModules();
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    vi.stubEnv(key, env[key] ?? "");
  }
  return import("./config");
}

describe("getAiConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the verified default model when ANTHROPIC_MODEL isn't set", async () => {
    const { getAiConfig, DEFAULT_AI_MODEL } = await configWith({
      ANTHROPIC_API_KEY: "test-key",
      SUPABASE_SECRET_KEY: "test-secret",
    });
    expect(DEFAULT_AI_MODEL).toBe("claude-sonnet-5-5");
    expect(getAiConfig()).toEqual({ configured: true, apiKey: "test-key", model: "claude-sonnet-5-5" });
  });

  it("uses ANTHROPIC_MODEL when it is a valid model ID", async () => {
    const { getAiConfig } = await configWith({
      ANTHROPIC_API_KEY: "test-key",
      SUPABASE_SECRET_KEY: "test-secret",
      ANTHROPIC_MODEL: " claude-opus-5-5 ",
    });
    expect(getAiConfig()).toMatchObject({ configured: true, model: "claude-opus-5-5" });
  });

  it("reports what's missing without exposing values", async () => {
    let c = await configWith({ SUPABASE_SECRET_KEY: "test-secret" });
    expect(c.getAiConfig()).toMatchObject({ configured: false, reason: "missing_api_key" });
    expect(c.isAiConfigured()).toBe(false);

    c = await configWith({ ANTHROPIC_API_KEY: "test-key" });
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
      c = await configWith({ ANTHROPIC_API_KEY: "test-key", SUPABASE_SECRET_KEY: "test-secret", ANTHROPIC_MODEL });
      expect(c.getAiConfig()).toMatchObject({ configured: false, reason: "invalid_model" });
    }
  });
});
