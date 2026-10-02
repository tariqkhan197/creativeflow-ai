import { describe, expect, it } from "vitest";
import { describeUploadError } from "./upload-errors";

describe("describeUploadError", () => {
  it("treats network loss as resumable", () => expect(describeUploadError(null).retryable).toBe(true));
  it("explains plan size limits and does not retry them", () => {
    expect(describeUploadError(413)).toMatchObject({ retryable: false });
    expect(describeUploadError(400, '{"message":"The object exceeded the maximum allowed size"}').retryable).toBe(
      false,
    );
  });
  it("does not retry rejected file types", () => expect(describeUploadError(415).retryable).toBe(false));
  it("retries auth, conflicts, rate limits and server errors", () => {
    for (const s of [401, 403, 409, 429, 500, 503]) expect(describeUploadError(s).retryable).toBe(true);
  });
});
