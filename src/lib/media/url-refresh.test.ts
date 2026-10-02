import { describe, expect, it } from "vitest";
import { REFRESH_MARGIN_MS, refreshDelay } from "./url-refresh";

describe("refreshDelay", () => {
  it("renews before expiry", () =>
    expect(refreshDelay(1_000_000 + 3_600_000, 1_000_000)).toBe(3_600_000 - REFRESH_MARGIN_MS));
  it("never schedules in the past", () => expect(refreshDelay(0, 1_000_000)).toBe(10_000));
});

import { shouldAutoRefresh } from "./url-refresh";

describe("shouldAutoRefresh", () => {
  it("refreshes the first time, then not again within the window", () => {
    expect(shouldAutoRefresh(null, 1000)).toBe(true);
    expect(shouldAutoRefresh(1000, 20_000)).toBe(false);
    expect(shouldAutoRefresh(1000, 40_000)).toBe(true);
  });
});
