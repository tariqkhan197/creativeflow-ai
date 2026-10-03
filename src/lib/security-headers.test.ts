import { describe, expect, it } from "vitest";
import config from "../../next.config";
import { SECURITY_HEADERS } from "./security-headers";

const header = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value;

describe("security headers", () => {
  it("forbid framing, MIME sniffing and full referrers", () => {
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("disable unused powerful features but keep fullscreen and clipboard", () => {
    const policy = header("Permissions-Policy") ?? "";
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
      expect(policy).toContain(`${feature}=()`);
    }
    expect(policy).not.toMatch(/fullscreen|clipboard/);
  });

  it("apply to every route and hide the framework banner", async () => {
    const nextConfig = config("phase-development-server");
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: SECURITY_HEADERS }]);
  });
});
