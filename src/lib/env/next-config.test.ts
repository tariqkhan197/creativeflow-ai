import { afterEach, describe, expect, it, vi } from "vitest";
import config from "../../../next.config";

const BUILD = "phase-production-build";
const START = "phase-production-server";

describe("next.config site URL check", () => {
  const argv = process.argv;
  afterEach(() => {
    process.argv = argv;
    vi.unstubAllEnvs();
  });

  it("fails production builds and starts without a site URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(() => config(BUILD)).toThrow(/Configuration error: NEXT_PUBLIC_SITE_URL is not set/);
    expect(() => config(START)).toThrow(/Configuration error/);
  });

  it("fails a Vercel production build that points at localhost", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    expect(() => config(BUILD)).toThrow(/isn't reachable/);
  });

  it("doesn't need the URL for `next typegen` (npm run typecheck) or the dev server", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    process.argv = [...argv, "typegen"];
    expect(() => config(BUILD)).not.toThrow();
    process.argv = argv;
    expect(() => config("phase-development-server")).not.toThrow();
  });
});
