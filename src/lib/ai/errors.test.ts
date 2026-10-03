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
