import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorView } from "./error-view";

describe("ErrorView", () => {
  it("shows a branded message, the reference, and recovery actions", () => {
    const html = renderToStaticMarkup(<ErrorView digest="abc123" onRetry={() => {}} />);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Reference: abc123");
    expect(html).toContain("Try again");
    expect(html).toContain('href="/"');
  });

  it("omits the reference line when there is no digest", () => {
    expect(renderToStaticMarkup(<ErrorView onRetry={() => {}} />)).not.toContain("Reference:");
  });
});
