import Anthropic from "@anthropic-ai/sdk";

export type AiFailureCode =
  | "not_configured"
  | "limit_reached"
  | "refused"
  | "truncated"
  | "invalid_output"
  | "auth"
  | "model_unavailable"
  | "rate_limited"
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
  return failure("unknown", "Something went wrong while generating. Please try again.", true);
}

/** Server-log details that help debugging without leaking secrets or content. */
export function logDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Anthropic.APIError) {
    return { kind: error.constructor.name, status: error.status ?? null, requestId: error.requestID ?? null };
  }
  if (error instanceof Error) return { kind: error.constructor.name };
  return { kind: typeof error };
}
