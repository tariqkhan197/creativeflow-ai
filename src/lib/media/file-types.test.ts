import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStoragePath,
  checkFileSize,
  displayName,
  effectiveUploadLimit,
  FILE_TYPES,
  formatBytes,
  resolveFileType,
  resumableEndpoint,
  sanitizeFileName,
  thumbnailPathFor,
} from "./file-types";

const WS = "11111111-1111-4111-8111-111111111111";
const PR = "22222222-2222-4222-8222-222222222222";
const AS = "33333333-3333-4333-8333-333333333333";

describe("allowlist", () => {
  it("matches the MIME types allowed by the database migration exactly", () => {
    const sql = readFileSync(
      path.resolve(import.meta.dirname, "../../../supabase/migrations/20261003000000_phase3_media_review.sql"),
      "utf8",
    );
    const bucketList = /set allowed_mime_types = array\[([\s\S]*?)\]/.exec(sql)![1];
    const dbMimes = [...bucketList.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(FILE_TYPES.map((t) => t.mime).sort()).toEqual(dbMimes);
  });
});

describe("resolveFileType", () => {
  it.each([
    ["Final Cut.MOV", "video/quicktime", "video/quicktime"],
    ["clip.mp4", "", "video/mp4"],
    ["clip.mp4", "application/octet-stream", "video/mp4"],
    ["song.mp3", "audio/mp3", "audio/mpeg"],
    ["still.JPG", "image/jpeg", "image/jpeg"],
    ["deck.pdf", "application/pdf", "application/pdf"],
    ["voice.wav", "audio/x-wav", "audio/wav"],
  ])("accepts %s (%s) as %s", (name, mime, expected) => {
    const r = resolveFileType(name, mime);
    expect(r.ok && r.type.mime).toBe(expected);
  });

  it("rejects unsupported extensions", () => {
    for (const name of ["setup.exe", "archive.zip", "noextension", "script.js", "page.html", "vector.svg"]) {
      expect(resolveFileType(name, "").ok).toBe(false);
    }
  });

  it("rejects a browser type that contradicts the extension", () => {
    expect(resolveFileType("clip.mp4", "application/x-msdownload").ok).toBe(false);
    expect(resolveFileType("photo.png", "video/mp4").ok).toBe(false);
    expect(resolveFileType("clip.mp4", "text/html").ok).toBe(false);
  });
});

describe("sanitizeFileName / paths", () => {
  it.each([
    ["Final cut (v2).mp4", "Final-cut-v2-.mp4"],
    ["Café Ad – 30s.mov", "Cafe-Ad-30s.mov"],
    ["../../etc/passwd.png", "etc-passwd.png"],
    ["   .mp4", "file.mp4"],
    ["thumbnail.jpg", "file-thumbnail.jpg"],
    ["日本語.pdf", "file.pdf"],
  ])("%j → %j", (input, expected) => {
    const safe = sanitizeFileName(input);
    expect(safe.replace(/-\./, ".")).toBe(expected.replace(/-\./, "."));
    expect(safe).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/);
  });

  it("keeps names within 200 characters", () => {
    expect(sanitizeFileName(`${"a".repeat(500)}.mp4`).length).toBeLessThanOrEqual(200);
  });

  it("builds the {workspace}/{project}/{asset}/{file} path and its thumbnail", () => {
    const p = buildStoragePath(WS, PR, AS, "My Cut.mp4");
    expect(p).toBe(`${WS}/${PR}/${AS}/My-Cut.mp4`);
    expect(thumbnailPathFor(p)).toBe(`${WS}/${PR}/${AS}/thumbnail.jpg`);
  });

  it("strips control characters from display names", () => {
    expect(displayName(" a\u0000b.mp4 ")).toBe("ab.mp4");
    expect(displayName("")).toBe("Untitled");
    expect(displayName("x".repeat(300)).length).toBe(255);
  });
});

describe("upload limits", () => {
  it("uses the smallest known limit", () => {
    expect(effectiveUploadLimit(5368709120, 52428800)).toBe(52428800);
    expect(effectiveUploadLimit(null, undefined)).toBeNull();
    expect(effectiveUploadLimit(null, 1000)).toBe(1000);
    expect(effectiveUploadLimit(0, -5, NaN)).toBeNull();
  });
  it("explains oversize and empty files", () => {
    expect(checkFileSize(100, 1000)).toBeNull();
    expect(checkFileSize(100, null)).toBeNull();
    expect(checkFileSize(0, null)).toMatch(/empty/);
    expect(checkFileSize(60 * 1024 * 1024, 50 * 1024 * 1024)).toBe(
      "This file is 60 MB, which exceeds the 50 MB upload limit.",
    );
  });
  it("formats bytes", () => {
    expect([formatBytes(512), formatBytes(1536), formatBytes(5368709120)]).toEqual(["512 B", "1.5 KB", "5.0 GB"]);
  });
});

describe("resumableEndpoint", () => {
  it("uses the direct storage host for supabase.co projects", () => {
    expect(resumableEndpoint("https://abcdefghijklmnopqrst.supabase.co")).toBe(
      "https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/upload/resumable",
    );
  });
  it("keeps custom domains and local URLs", () => {
    expect(resumableEndpoint("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321/storage/v1/upload/resumable");
    expect(resumableEndpoint("https://api.example.com/")).toBe("https://api.example.com/storage/v1/upload/resumable");
  });
});
