/**
 * Integration test: runs the real tus-js-client wrapper against a real TUS
 * protocol server (@tus/server) in-process. Supabase Storage implements the
 * same protocol; this verifies our headers, metadata, chunking, pause/resume
 * and error handling end to end without network access.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { FileStore } from "@tus/file-store";
import { Server } from "@tus/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UploadTarget } from "@/lib/actions/assets";
import { RESUMABLE_CHUNK_SIZE } from "./file-types";
import { createResumableUpload } from "./resumable-upload";

const dir = mkdtempSync(path.join(os.tmpdir(), "cf-tus-"));
const requests: { method: string; auth?: string; apikey?: string; upsert?: string; length: number }[] = [];
const finished: { metadata: Record<string, string | null>; size?: number; id: string }[] = [];
let baseUrl = "";
let httpServer: http.Server;

beforeAll(async () => {
  const tus = new Server({
    path: "/storage/v1/upload/resumable",
    datastore: new FileStore({ directory: dir }),
    maxSize: 20 * 1024 * 1024,
    onUploadFinish: async (_req, upload) => {
      finished.push({
        metadata: (upload.metadata ?? {}) as Record<string, string | null>,
        size: upload.size,
        id: upload.id,
      });
      return {};
    },
  });
  httpServer = http.createServer((req, res) => {
    if (req.method === "POST" || req.method === "PATCH") {
      requests.push({
        method: req.method,
        auth: req.headers.authorization,
        apikey: req.headers.apikey as string | undefined,
        upsert: req.headers["x-upsert"] as string | undefined,
        length: Number(req.headers["content-length"] ?? 0),
      });
    }
    void tus.handle(req, res);
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(() => {
  httpServer?.close();
  rmSync(dir, { recursive: true, force: true });
});

const target = (assetId: string): UploadTarget => ({
  assetId,
  projectId: "p",
  bucket: "project-assets",
  objectName: `ws/p/${assetId}/cut.mp4`,
  thumbnailObjectName: `ws/p/${assetId}/thumbnail.jpg`,
  contentType: "video/mp4",
  kind: "video",
  endpoint: `${baseUrl}/storage/v1/upload/resumable`,
});

function bytes(size: number) {
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i++) b[i] = (i * 31 + 7) % 251;
  return b;
}

function upload(file: Buffer, assetId: string, tokens: string[] = ["token-1"]) {
  let n = 0;
  const progress: number[] = [];
  let resolveDone!: () => void;
  let rejectDone!: (e: { message: string; retryable: boolean }) => void;
  const done = new Promise<void>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });
  const handle = createResumableUpload(
    file as unknown as File,
    target(assetId),
    { publishableKey: "sb_publishable_test", getAccessToken: async () => tokens[Math.min(n++, tokens.length - 1)] },
    {
      onProgress: (sent) => progress.push(sent),
      onSuccess: () => resolveDone(),
      onError: (message, retryable) => rejectDone({ message, retryable }),
    },
  );
  return { handle, done, progress };
}

describe("resumable upload (real TUS server)", () => {
  it("uploads in 6 MB chunks with Supabase metadata and fresh auth on every request", async () => {
    requests.length = 0;
    const file = bytes(13 * 1024 * 1024);
    const { handle, done, progress } = upload(file, "a1", ["t1", "t2", "t3", "t4", "t5"]);
    await handle.start();
    await done;

    const meta = finished.at(-1)!;
    expect(meta.metadata).toMatchObject({
      bucketName: "project-assets",
      objectName: "ws/p/a1/cut.mp4",
      contentType: "video/mp4",
      cacheControl: "3600",
    });
    expect(readFileSync(path.join(dir, meta.id)).equals(file)).toBe(true);

    expect(requests.every((r) => r.apikey === "sb_publishable_test" && r.upsert === "true")).toBe(true);
    expect(requests.every((r) => r.length <= RESUMABLE_CHUNK_SIZE)).toBe(true);
    expect(requests.length).toBe(3); // 6 MB in the POST, then 6 MB + 1 MB PATCHes
    expect(new Set(requests.map((r) => r.auth)).size).toBe(3); // token re-read per request
    expect(progress.at(-1)).toBe(file.length);
  });

  it("pauses and resumes the same upload without restarting it", async () => {
    requests.length = 0;
    const file = bytes(14 * 1024 * 1024);
    let paused = false;
    const { handle, done } = upload(file, "a2");
    const tus = handle;
    // Pause immediately (while the upload is still being created): the pause
    // must be deferred until the server issues the upload URL, so resuming
    // continues the same upload instead of starting a new one.
    const interval = setInterval(() => {
      if (!paused && requests.length >= 1) {
        paused = true;
        void tus.pause().then(() => setTimeout(() => tus.resume(), 50));
      }
    }, 5);
    await tus.start();
    await done;
    clearInterval(interval);
    expect(paused).toBe(true);
    expect(requests.filter((r) => r.method === "POST").length).toBe(1);
    expect(readFileSync(path.join(dir, finished.at(-1)!.id)).equals(file)).toBe(true);
  });

  it("reports files over the server limit clearly and does not retry them", async () => {
    const { handle, done } = upload(bytes(21 * 1024 * 1024), "a3");
    await handle.start();
    await expect(done).rejects.toMatchObject({
      retryable: false,
      message: expect.stringMatching(/larger than your Supabase project allows/),
    });
  });
});
