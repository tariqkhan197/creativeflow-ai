import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LandingPage from "./page";

// Features that are not built yet must only be mentioned in the "Coming soon" block.
const UNBUILT = [
  /\bAI scripts?\b/i,
  /storyboard/i,
  /invoic/i,
  /stripe/i,
  /payments?\b/i,
  /analytics/i,
  /by email/i,
  /mention/i,
];

function render() {
  const html = renderToStaticMarkup(<LandingPage />);
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
  const start = text.indexOf("Coming soon — not available yet");
  // The coming-soon list ends where the next section heading starts.
  const end = text.indexOf("Workflow", start);
  return { text, start, end };
}

describe("landing page", () => {
  it("labels unbuilt features as coming soon", () => {
    const { text, start, end } = render();
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const outside = text.slice(0, start) + text.slice(end);
    for (const pattern of UNBUILT) expect(outside).not.toMatch(pattern);
    const comingSoon = text.slice(start, end);
    expect(comingSoon).toMatch(/AI scripts & storyboards/);
    expect(comingSoon).toMatch(/Invoices & online payments/);
    expect(comingSoon).toMatch(/Analytics/);
  });

  it("still presents the features that exist", () => {
    const { text } = render();
    for (const feature of ["Frame-accurate video review", "Approvals with a paper trail", "client portal"]) {
      expect(text).toContain(feature);
    }
  });
});
