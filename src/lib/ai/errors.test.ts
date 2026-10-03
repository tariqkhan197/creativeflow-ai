import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AiResponseError, logDetails, toAiFailure } from "./errors";

const apiError = (status: number) =>
  Anthropic.APIError.generate(
    status,
    { type: "error", error: { type: "x", message: "raw upstream detail sk-ant-secret" } },
    undefined,
    new Headers({ "request-id": "req_123" }),
  );

describe("toAiFailure", () => {
  it.each([
    [401, "auth", false],
    [403, "auth", false],
    [404, "model_unavailable", false],
    [429, "rate_limited", true],
    [500, "overloaded", true],
    [529, "overloaded", true],
    [400, "rejected", false],
    [422, "rejected", false],
    [409, "unknown", true],
  ])("maps HTTP %i to %s", (status, code, retryable) => {
    const f = toAiFailure(apiError(status));
    expect(f.code).toBe(code);
    expect(f.retryable).toBe(retryable);
    expect(f.message).not.toMatch(/sk-ant|upstream|req_123/);
  });

  it("maps timeouts and connection errors (timeout first: it is a connection error subclass)", () => {
    expect(toAiFailure(new Anthropic.APIConnectionTimeoutError()).code).toBe("timeout");
    expect(toAiFailure(new Anthropic.APIConnectionError({ message: "ECONNRESET" })).code).toBe("network");
  });

  it("keeps our own response checks and hides unknown errors", () => {
    expect(toAiFailure(new AiResponseError("refused", "declined"))).toEqual({
      code: "refused",
      message: "declined",
      retryable: false,
    });
    expect(toAiFailure(new AiResponseError("truncated", "cut off")).retryable).toBe(true);
    const unknown = toAiFailure(new Error("database password is hunter2"));
    expect(unknown.code).toBe("unknown");
    expect(unknown.message).not.toContain("hunter2");
  });
});

describe("logDetails", () => {
  it("logs status and request id only, never the error text", () => {
    expect(logDetails(apiError(429))).toEqual({ kind: "RateLimitError", status: 429, requestId: "req_123" });
    expect(JSON.stringify(logDetails(new Error("secret value")))).not.toContain("secret value");
  });
});

describe("toAiFailure with Gemini errors", () => {
  const geminiError = async (status: number, error: Record<string, unknown>) => {
    const { ApiError } = await import("@google/genai");
    return new ApiError({ status, message: JSON.stringify({ error: { code: status, ...error } }) });
  };
  const quota = (quotaId: string, quotaValue = "250", message = "Quota exceeded for metric (detail AIzaSecret)") => ({
    status: "RESOURCE_EXHAUSTED",
    message,
    details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId, quotaValue }] }],
  });

  it("tells a used-up daily free quota apart from the per-minute rate limit", async () => {
    const daily = toAiFailure(await geminiError(429, quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier")));
    expect(daily).toMatchObject({ code: "quota_exceeded", retryable: false });
    expect(daily.message).toMatch(/resets at midnight Pacific/);

    const perMinute = toAiFailure(
      await geminiError(429, quota("GenerateRequestsPerMinutePerProjectPerModel-FreeTier")),
    );
    expect(perMinute).toMatchObject({ code: "rate_limited", retryable: true });
    expect(perMinute.message).toMatch(/wait a minute/);

    const bare = toAiFailure(await geminiError(429, { status: "RESOURCE_EXHAUSTED", message: "x" }));
    expect(bare.code).toBe("rate_limited");
  });

  it("explains a model without free-tier quota (a paid-only model) instead of retrying", async () => {
    const byValue = toAiFailure(
      await geminiError(429, quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "0")),
    );
    expect(byValue).toMatchObject({ code: "model_unavailable", retryable: false });
    expect(byValue.message).toMatch(/no free-tier quota/);
    const byText = toAiFailure(
      await geminiError(429, {
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded for metric: x, limit: 0, model: y",
      }),
    );
    expect(byText.code).toBe("model_unavailable");
  });

  it.each([
    [400, { status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] }, "auth"],
    [403, { status: "PERMISSION_DENIED" }, "auth"],
    [404, { status: "NOT_FOUND" }, "model_unavailable"],
    [400, { status: "FAILED_PRECONDITION", message: "User location is not supported" }, "rejected"],
    [400, { status: "INVALID_ARGUMENT", message: "bad schema" }, "rejected"],
    [500, { status: "INTERNAL" }, "overloaded"],
    [503, { status: "UNAVAILABLE", message: "The model is overloaded" }, "overloaded"],
    [504, { status: "DEADLINE_EXCEEDED" }, "timeout"],
  ])("maps HTTP %i (%o) to %s without exposing the response", async (status, body, code) => {
    const f = toAiFailure(await geminiError(status, body));
    expect(f.code).toBe(code);
    expect(f.message).not.toMatch(/AIza|location|overloaded\b.*model|schema/);
  });

  it("names the Gemini settings in admin messages", async () => {
    expect(toAiFailure(await geminiError(403, { status: "PERMISSION_DENIED" })).message).toMatch(/GEMINI_API_KEY/);
    expect(toAiFailure(await geminiError(404, { status: "NOT_FOUND" })).message).toMatch(/GEMINI_MODEL/);
  });

  it("maps timeouts and network failures from fetch", () => {
    const abort = new Error("This operation was aborted");
    abort.name = "AbortError";
    expect(toAiFailure(abort).code).toBe("timeout");
    expect(toAiFailure(new TypeError("fetch failed")).code).toBe("network");
  });

  it("logs status and quota IDs only", async () => {
    const details = logDetails(await geminiError(429, quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier")));
    expect(details).toEqual({
      kind: "GeminiApiError",
      status: 429,
      googleStatus: "RESOURCE_EXHAUSTED",
      quotaIds: ["GenerateRequestsPerDayPerProjectPerModel-FreeTier"],
    });
    expect(JSON.stringify(details)).not.toContain("AIza");
  });
});
