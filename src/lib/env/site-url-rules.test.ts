import { describe, expect, it } from "vitest";
import { LOCAL_DEV_SITE_URL, resolveSiteUrl, siteUrlEnvFrom } from "./site-url-rules";

const ok = (url: string) => ({ ok: true, url });
const error = (r: ReturnType<typeof resolveSiteUrl>) => (r.ok ? "" : r.error);

describe("resolveSiteUrl", () => {
  it("defaults to localhost only in development and tests", () => {
    expect(resolveSiteUrl({ nodeEnv: "development" })).toEqual(ok(LOCAL_DEV_SITE_URL));
    expect(resolveSiteUrl({ nodeEnv: "test" })).toEqual(ok(LOCAL_DEV_SITE_URL));
    expect(resolveSiteUrl({})).toEqual(ok(LOCAL_DEV_SITE_URL));
  });

  it("requires the URL in production instead of silently using localhost", () => {
    expect(error(resolveSiteUrl({ nodeEnv: "production" }))).toMatch(/NEXT_PUBLIC_SITE_URL is not set/);
    expect(error(resolveSiteUrl({ nodeEnv: "production", siteUrl: "   " }))).toMatch(/not set/);
    expect(
      error(resolveSiteUrl({ nodeEnv: "production", vercelEnv: "production", vercelUrl: "x.vercel.app" })),
    ).toMatch(/not set/);
  });

  it("uses a Vercel preview's own URL when none is set for previews", () => {
    expect(resolveSiteUrl({ nodeEnv: "production", vercelEnv: "preview", vercelUrl: "cf-abc.vercel.app" })).toEqual(
      ok("https://cf-abc.vercel.app"),
    );
  });

  it("rejects localhost and plain http on deployments", () => {
    for (const siteUrl of [
      "http://localhost:3000",
      "https://localhost",
      "https://127.0.0.1",
      "http://0.0.0.0:3000",
      "https://[::1]",
      "https://app.localhost",
    ]) {
      expect(error(resolveSiteUrl({ nodeEnv: "production", vercelEnv: "production", siteUrl }))).toMatch(
        /isn't reachable|https/,
      );
      expect(resolveSiteUrl({ nodeEnv: "production", requirePublic: "true", siteUrl }).ok).toBe(false);
    }
    expect(
      error(resolveSiteUrl({ nodeEnv: "production", vercelEnv: "preview", siteUrl: "http://app.example.com" })),
    ).toMatch(/https/);
  });

  it("accepts a public https origin and normalises the trailing slash", () => {
    expect(
      resolveSiteUrl({ nodeEnv: "production", vercelEnv: "production", siteUrl: "https://app.example.com/" }),
    ).toEqual(ok("https://app.example.com"));
    expect(resolveSiteUrl({ nodeEnv: "production", siteUrl: " https://App.Example.com " })).toEqual(
      ok("https://app.example.com"),
    );
  });

  it("allows localhost for local production builds (npm run build / start)", () => {
    expect(resolveSiteUrl({ nodeEnv: "production", siteUrl: "http://localhost:3000" })).toEqual(
      ok("http://localhost:3000"),
    );
  });

  it("rejects malformed values everywhere", () => {
    for (const siteUrl of [
      "app.example.com",
      "ftp://app.example.com",
      "https://app.example.com/app",
      "https://a.com?x=1",
    ]) {
      expect(resolveSiteUrl({ nodeEnv: "development", siteUrl }).ok).toBe(false);
    }
  });

  it("reads the expected variables", () => {
    expect(
      siteUrlEnvFrom({
        NEXT_PUBLIC_SITE_URL: "https://a.example",
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
        VERCEL_URL: "p.vercel.app",
        REQUIRE_PUBLIC_SITE_URL: "true",
        OTHER: "ignored",
      }),
    ).toEqual({
      siteUrl: "https://a.example",
      nodeEnv: "production",
      vercelEnv: "preview",
      vercelUrl: "p.vercel.app",
      requirePublic: "true",
    });
  });
});
