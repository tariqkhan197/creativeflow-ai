#!/usr/bin/env node
/**
 * Browser test for the review page UI: viewers (video, audio, image,
 * unsupported formats, expired-URL recovery, shortcuts, pins) and the comment
 * workflow (timestamped comments, pins, replies, edit, resolve, filters, delete).
 *
 * Bundles the real components from src/components/review with esbuild and
 * drives them in Chromium using media generated in the page (a MediaRecorder
 * WebM, a canvas PNG, a synthesized WAV). The only stub is the signed-URL
 * and comment Server Actions (tests/browser/stub-*.ts), which need Next.js +
 * Supabase; their rules are tested in scripts/test-db.mjs and verify:supabase. Requires a prior `npm run build` (for the app's compiled CSS) and
 * a Chromium for Playwright (`npx playwright install chromium`).
 *
 *   npm run build && npm run test:browser
 */
import { build } from "esbuild";
import { chromium } from "playwright";
import http from "node:http";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const cssDir = path.join(root, ".next/static/chunks");
const css = existsSync(cssDir) ? readdirSync(cssDir).filter((f) => f.endsWith(".css")) : [];
if (!css.length) {
  console.error("No compiled CSS found. Run `npm run build` first.");
  process.exit(1);
}
const dir = mkdtempSync(path.join(os.tmpdir(), "cf-viewer-"));
await build({
  entryPoints: [path.join(import.meta.dirname, "harness.tsx")],
  bundle: true,
  outfile: path.join(dir, "bundle.js"),
  format: "iife",
  jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  alias: {
    "@/lib/actions/assets": path.join(import.meta.dirname, "stub-asset-actions.ts"),
    "@/lib/actions/comments": path.join(import.meta.dirname, "stub-comment-actions.ts"),
  },
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
});
writeFileSync(
  path.join(dir, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8">${css.map((f) => `<link rel="stylesheet" href="/css/${f}">`).join("")}</head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`,
);
const server = http
  .createServer((req, res) => {
    const url = req.url.split("?")[0];
    const file =
      url === "/"
        ? path.join(dir, "index.html")
        : url.startsWith("/css/")
          ? path.join(cssDir, url.slice(5))
          : path.join(dir, url.slice(1));
    try {
      res.end(readFileSync(file));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  })
  .listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
let pass = 0,
  fail = 0;
const check = (name, ok, extra = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
};

async function fresh() {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(base);
  return page;
}

// Real 2-second 25 fps WebM recorded from a canvas.
const makeWebm = `(async () => {
  const c = document.createElement("canvas"); c.width = 320; c.height = 180;
  const ctx = c.getContext("2d"); const stream = c.captureStream(25);
  const rec = new MediaRecorder(stream, { mimeType: "video/webm" }); const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  let f = 0; const iv = setInterval(() => { ctx.fillStyle = "hsl(" + (f++ * 7) + ",70%,50%)"; ctx.fillRect(0, 0, 320, 180); }, 40);
  rec.start(); await new Promise((r) => setTimeout(r, 2000)); rec.stop(); clearInterval(iv);
  await new Promise((r) => (rec.onstop = r));
  return URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
})()`;

{
  const page = await fresh();
  const src = await page.evaluate(makeWebm);
  await page.evaluate((s) => {
    window.__currentSrc = s;
    window.mount(s, "video", "video/webm");
  }, src);
  await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1, null, { timeout: 10000 });
  await page.waitForFunction(() => /\/ 0:0[12]/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
  check(
    "video loads and resolves the real duration of a MediaRecorder WebM",
    /\/ 0:0[12]/.test(await page.innerText("body")),
    (await page.innerText("body")).match(/\/ \S+/)?.[0],
  );

  await page.evaluate(() => window.__h.ref.current.seek(1));
  await page.waitForTimeout(300);
  check(
    "seek via the player handle",
    Math.abs(Number(await page.innerText("#time")) - 1) < 0.05,
    await page.innerText("#time"),
  );
  check("pin shown when paused at its timestamp", (await page.locator('button[aria-label="Pin: pin"]').count()) === 1);

  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  check(
    "→ steps one frame at 25 fps",
    Math.abs(Number(await page.innerText("#time")) - 1.04) < 0.01,
    await page.innerText("#time"),
  );
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  check("← steps back", Math.abs(Number(await page.innerText("#time")) - 0.96) < 0.01, await page.innerText("#time"));

  await page.evaluate(() => window.__h.ref.current.seek(0));
  await page.click('button[aria-label^="Comment at 0:01"]');
  await page.waitForTimeout(300);
  check("clicking a timeline marker seeks to it", Math.abs(Number(await page.innerText("#time")) - 1) < 0.05);

  await page.keyboard.press("k");
  await page.waitForTimeout(800);
  const playing = await page.evaluate(() => !document.querySelector("video").paused);
  check("K plays", playing);
  check("pins hidden while playing", (await page.locator('button[aria-label="Pin: pin"]').count()) === 0);
  await page.keyboard.press("k");
  check("K pauses", await page.evaluate(() => document.querySelector("video").paused));

  await page.keyboard.press("c");
  check("C requests a comment", await page.evaluate(() => window.__commentRequested === true));

  await page.evaluate(() => window.__h.setPick(true));
  await page.waitForSelector("text=Click the frame to place a pin");
  const box = await page.locator("video").boundingBox();
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.75);
  const picked = await page.evaluate(() => window.__picked);
  check(
    "pin placement returns normalized frame coordinates",
    picked && Math.abs(picked.x - 0.25) < 0.02 && Math.abs(picked.y - 0.75) < 0.02,
    JSON.stringify(picked),
  );

  const speedOk = await page
    .selectOption('select[aria-label="Playback speed"]', "1.5")
    .then(() => page.evaluate(() => document.querySelector("video").playbackRate === 1.5));
  check("playback speed", speedOk);
  await page.close();
}

{
  // Expired/broken link: first URL fails, one refresh brings a working URL.
  const page = await fresh();
  const src = await page.evaluate(makeWebm);
  await page.evaluate((s) => {
    window.__currentSrc = s;
    window.mount("http://127.0.0.1:9/expired.webm", "video", "video/webm");
  }, src);
  await page
    .waitForFunction(() => document.querySelector("video")?.readyState >= 1, null, { timeout: 10000 })
    .catch(() => {});
  const refreshes = await page.evaluate(() => window.__refreshes);
  const ready = await page.evaluate(() => (document.querySelector("video")?.readyState ?? 0) >= 1);
  check("an expired URL is refreshed once and playback recovers", refreshes === 1 && ready, `refreshes=${refreshes}`);
  await page.close();
}

{
  // Stored file the browser can't decode.
  const page = await fresh();
  const bad = await page.evaluate(() =>
    URL.createObjectURL(new Blob([new Uint8Array(4096).map((_, i) => i % 251)], { type: "video/x-msvideo" })),
  );
  await page.evaluate((s) => {
    window.__currentSrc = s;
    window.mount(s, "video", "video/x-msvideo");
  }, bad);
  await page
    .waitForSelector("text=This format cannot be previewed in the browser. Download to view.", { timeout: 10000 })
    .catch(() => {});
  const msg = await page.locator("text=This format cannot be previewed in the browser. Download to view.").count();
  const dl = await page.locator('a:has-text("Download")').count();
  check("undecodable video shows the unsupported message with a download link", msg === 1 && dl === 1);
  await page.close();
}

{
  const page = await fresh();
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 300;
    c.getContext("2d").fillRect(0, 0, 400, 300);
    return URL.createObjectURL(await new Promise((r) => c.toBlob(r, "image/png")));
  });
  await page.evaluate((s) => {
    window.__currentSrc = s;
    window.mount(s, "image", "image/png");
  }, png);
  await page.waitForSelector('img[alt="clip"]');
  await page.waitForTimeout(300);
  check("image renders with its pins", (await page.locator('button[aria-label="Pin: pin"]').count()) === 1);
  await page.close();

  const page2 = await fresh();
  const tiff = await page2.evaluate(() =>
    URL.createObjectURL(new Blob([new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])], { type: "image/tiff" })),
  );
  await page2.evaluate((s) => {
    window.__currentSrc = s;
    window.mount(s, "image", "image/tiff");
  }, tiff);
  await page2.waitForSelector("text=This format cannot be previewed", { timeout: 8000 }).catch(() => {});
  check(
    "unsupported image format shows the honest message",
    (await page2.locator("text=This format cannot be previewed").count()) === 1,
  );
  await page2.close();
}

{
  const page = await fresh();
  const wav = await page.evaluate(() => {
    const rate = 8000,
      secs = 3,
      n = rate * secs,
      buf = new ArrayBuffer(44 + n * 2),
      v = new DataView(buf);
    const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    w(0, "RIFF");
    v.setUint32(4, 36 + n * 2, true);
    w(8, "WAVE");
    w(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, "data");
    v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 10) * 8000, true);
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  });
  await page.evaluate((s) => {
    window.__currentSrc = s;
    window.mount(s, "audio", "audio/wav");
  }, wav);
  await page.waitForFunction(() => /\/ 0:03/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
  check(
    "audio loads its real duration and timeline marker",
    /\/ 0:03/.test(await page.innerText("body")) &&
      (await page.locator('button[aria-label^="Comment at 0:01"]').count()) === 1,
  );
  await page.click('button[aria-label^="Comment at 0:01"]');
  await page.waitForTimeout(200);
  check("audio marker seeks", Math.abs(Number(await page.innerText("#time")) - 1) < 0.05);
  await page.close();
}

{
  // Comment workflow on the full review workspace.
  const page = await fresh();
  const src = await page.evaluate(makeWebm);
  await page.evaluate((s) => window.mountWorkspace(s, "video", "video/webm", 2), src);
  await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1, null, { timeout: 10000 });
  await page.evaluate(() => {
    const v = document.querySelector("video");
    v.currentTime = 1;
  });
  await page.waitForFunction(() => Math.abs(document.querySelector("video").currentTime - 1) < 0.05);
  await page.waitForTimeout(200);

  await page.keyboard.press("c");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  check("C focuses the comment box", focused === "New comment");

  await page.fill('textarea[aria-label="New comment"]', "Logo is too small");
  await page.getByRole("button", { name: "Add pin", exact: true }).click();
  const box = await page.locator("video").boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
  check("placing a pin attaches it to the draft", (await page.locator("text=Pin placed").count()) === 1);
  await page.keyboard.press("Control+Enter");
  await page.waitForSelector("li[id^=comment-]");
  const stored = await page.evaluate(() => [...window.__comments.values()][0]);
  check(
    "posting stores the current timestamp and normalized pin",
    Math.abs(stored.timestamp_seconds - 1) < 0.05 &&
      Math.abs(stored.annotation.x - 0.3) < 0.02 &&
      Math.abs(stored.annotation.y - 0.4) < 0.02,
    JSON.stringify({ t: stored.timestamp_seconds, a: stored.annotation }),
  );
  check(
    "the comment shows a jump-to timecode",
    (await page.locator('button[aria-label="Jump to 0:01"]').count()) === 1,
  );
  check("a timeline marker appears", (await page.locator('button[aria-label^="Comment at 0:01"]').count()) === 1);
  check(
    "its pin is drawn on the paused frame",
    (await page.locator('button[aria-label="Pin: Logo is too small"]').count()) === 1,
  );

  await page.evaluate(() => (document.querySelector("video").currentTime = 0));
  await page.waitForTimeout(200);
  await page.click('button[aria-label="Jump to 0:01"]');
  await page.waitForTimeout(300);
  check(
    "clicking the timecode seeks the player",
    Math.abs((await page.evaluate(() => document.querySelector("video").currentTime)) - 1) < 0.05,
  );

  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.fill('textarea[aria-label="Reply"]', "On it");
  await page.click('form button:has-text("Reply")');
  await page.waitForSelector("text=On it");
  check("replies appear under their thread", (await page.locator("li[id^=comment-] ol >> text=On it").count()) === 1);

  await page.locator('button[aria-label="Edit comment"]').first().click();
  await page.fill('textarea[aria-label="Edit comment"]', "Logo is too small — make it 20% bigger");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForSelector("text=make it 20% bigger");
  check("editing updates the text and marks it edited", (await page.locator("text=(edited)").count()) === 1);

  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await page.waitForSelector("text=No open comments.");
  check("resolving removes the thread from Open", (await page.locator("li[id^=comment-]").count()) === 0);
  await page.getByRole("tab", { name: /^resolved/ }).click();
  check("the Resolved filter shows it", (await page.locator("text=make it 20% bigger").count()) === 1);
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await page.getByRole("tab", { name: /^open/ }).click();
  check("reopening returns it to Open", (await page.locator("text=make it 20% bigger").count()) === 1);

  await page.locator('button[aria-label="Delete comment"]').first().click();
  await page.click('[role="alertdialog"] button:has-text("Delete")');
  await page.waitForSelector("text=No open comments.");
  check("deleting a thread removes it and its replies", (await page.locator("text=On it").count()) === 0);
  await page.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
