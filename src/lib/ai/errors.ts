import Anthropic from "@anthropic-ai/sdk";
import { ApiError as GeminiApiError } from "@google/genai";

export type AiFailureCode =
  | "not_configured"
  | "limit_reached"
  | "refused"
  | "truncated"
  | "invalid_output"
  | "auth"
  | "model_unavailable"
  | "rate_limited"
  | "quota_exceeded"
  | "overloaded"
  | "timeout"
  | "network"
  | "rejected"
  | "unknown";

/** A failure safe to show users and to store in ai_generations.error. */
export type AiFailure = { code: AiFailureCode; message: string; retryable: boolean };

/** Errors raised by our own checks of the model's response. */
export class AiResponseError extends Error {
  constructor(
    readonly code: "refused" | "truncated" | "invalid_output",
    message: string,
  ) {
    super(message);
    this.name = "AiResponseError";
  }
}

const failure = (code: AiFailureCode, message: string, retryable: boolean): AiFailure => ({
  code,
  message,
  retryable,
});

/**
 * Maps any error from a model call to a user-safe failure. Raw API messages,
 * request IDs and credentials are never included. Most specific first: in the
 * TypeScript SDK, APIConnectionError is a subclass of APIError.
 */
export function toAiFailure(error: unknown): AiFailure {
  if (error instanceof AiResponseError) {
    return failure(error.code, error.message, error.code !== "refused");
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return failure("timeout", "The AI service took too long to respond. Please try again.", true);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return failure("network", "Couldn't reach the AI service. Please try again in a moment.", true);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return failure(
      "auth",
      "The AI service didn't accept the server's credentials. An administrator needs to check ANTHROPIC_API_KEY.",
      false,
    );
  }
  if (error instanceof Anthropic.NotFoundError) {
    return failure(
      "model_unavailable",
      "The configured AI model isn't available. An administrator needs to check ANTHROPIC_MODEL.",
      false,
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return failure("rate_limited", "The AI service is busy right now. Please try again in a minute.", true);
  }
  if (error instanceof Anthropic.InternalServerError) {
    return failure(
      "overloaded",
      "The AI service is temporarily unavailable or overloaded. Please try again shortly.",
      true,
    );
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.UnprocessableEntityError) {
    return failure(
      "rejected",
      "The AI service couldn't process this request. Try shortening or rewording the brief.",
      false,
    );
  }
  if (error instanceof Anthropic.APIError) {
    return failure("unknown", "The AI request failed. Please try again.", true);
  }
  if (error instanceof GeminiApiError) return geminiFailure(error);
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return failure("timeout", "The AI service took too long to respond. Please try again.", true);
  }
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
    return failure("network", "Couldn't reach the AI service. Please try again in a moment.", true);
  }
  return failure("unknown", "Something went wrong while generating. Please try again.", true);
}

/** The parts of a Google API error body (google.rpc.Status) used to classify it. */
type GoogleErrorInfo = { status: string; reasons: string[]; quotaIds: string[]; noQuota: boolean };

/**
 * Reads Google's error body, which the SDK puts in ApiError.message as JSON.
 * Only status codes and quota identifiers are kept; the text is never shown.
 */
export function readGoogleError(error: GeminiApiError): GoogleErrorInfo {
  let body: unknown;
  try {
    body = JSON.parse(error.message);
  } catch {
    body = null;
  }
  const e = (body as { error?: Record<string, unknown> } | null)?.error ?? {};
  const details = Array.isArray(e.details) ? (e.details as Record<string, unknown>[]) : [];
  const reasons = details.map((d) => d.reason).filter((r): r is string => typeof r === "string");
  const violations = details.flatMap((d) =>
    Array.isArray(d.violations) ? (d.violations as Record<string, unknown>[]) : [],
  );
  const quotaIds = violations.map((v) => v.quotaId).filter((q): q is string => typeof q === "string");
  const text = typeof e.message === "string" ? e.message : "";
  return {
    status: typeof e.status === "string" ? e.status : "",
    reasons,
    quotaIds,
    // A quota of 0 means the project has no free-tier access to this model.
    noQuota: /\blimit: 0\b/.test(text) || violations.some((v) => v.quotaValue === "0"),
  };
}

function geminiFailure(error: GeminiApiError): AiFailure {
  const info = readGoogleError(error);
  const status = error.status;
  if (status === 429) {
    if (info.noQuota) {
      return failure(
        "model_unavailable",
        "The configured Gemini model has no free-tier quota for this project. An administrator needs to set GEMINI_MODEL to a free-tier model.",
        false,
      );
    }
    if (info.quotaIds.some((id) => /PerDay/i.test(id))) {
      return failure(
        "quota_exceeded",
        "The free Gemini quota for today has been used up. It resets at midnight Pacific time; please try again after that.",
        false,
      );
    }
    return failure("rate_limited", "The free Gemini rate limit was reached. Please wait a minute and try again.", true);
  }
  if (
    status === 401 ||
    status === 403 ||
    info.reasons.includes("API_KEY_INVALID") ||
    info.status === "UNAUTHENTICATED" ||
    info.status === "PERMISSION_DENIED"
  ) {
    return failure(
      "auth",
      "The AI service didn't accept the server's credentials. An administrator needs to check GEMINI_API_KEY.",
      false,
    );
  }
  if (status === 404) {
    return failure(
      "model_unavailable",
      "The configured AI model isn't available. An administrator needs to check GEMINI_MODEL.",
      false,
    );
  }
  if (info.status === "FAILED_PRECONDITION") {
    return failure(
      "rejected",
      "The Gemini API can't be used from this server's project or region. An administrator needs to check the Gemini API setup.",
      false,
    );
  }
  if (status === 408 || status === 504) {
    return failure("timeout", "The AI service took too long to respond. Please try again.", true);
  }
  if (status >= 500) {
    return failure(
      "overloaded",
      "The AI service is temporarily unavailable or overloaded. Please try again shortly.",
      true,
    );
  }
  if (status >= 400) {
    return failure(
      "rejected",
      "The AI service couldn't process this request. Try shortening or rewording the brief.",
      false,
    );
  }
  return failure("unknown", "The AI request failed. Please try again.", true);
}

/** Server-log details that help debugging without leaking secrets or content. */
export function logDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Anthropic.APIError) {
    return { kind: error.constructor.name, status: error.status ?? null, requestId: error.requestID ?? null };
  }
  if (error instanceof GeminiApiError) {
    const info = readGoogleError(error);
    return { kind: "GeminiApiError", status: error.status, googleStatus: info.status || null, quotaIds: info.quotaIds };
  }
  if (error instanceof Error) return { kind: error.constructor.name };
  return { kind: typeof error };
}
