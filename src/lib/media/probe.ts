import type { AssetKind } from "@/types/database";
import { resolveDuration } from "@/lib/media/duration";
import { estimateFrameRate } from "@/lib/media/frame-rate";

export type MediaProbe = {
  durationSeconds?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  thumbnail?: Blob;
  /** False when this browser cannot decode the file (it is still uploaded and stored). */
  previewable: boolean;
  notes: string[];
};

const THUMB_MAX_WIDTH = 640;
const TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

function once(target: EventTarget, ok: string, fail = "error"): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(ok, onOk);
      target.removeEventListener(fail, onFail);
    };
    const onOk = () => (cleanup(), resolve());
    const onFail = () => (cleanup(), reject(new Error(fail)));
    target.addEventListener(ok, onOk);
    target.addEventListener(fail, onFail);
  });
}

function canvasToJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob | undefined> {
  const scale = Math.min(1, THUMB_MAX_WIDTH / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(undefined);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), "image/jpeg", 0.82));
}

const finite = (n: number) => (Number.isFinite(n) && n > 0 ? n : undefined);

async function probeVideo(url: string): Promise<MediaProbe> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  const notes: string[] = [];
  try {
    await withTimeout(once(video, "loadedmetadata"));
  } catch {
    return {
      previewable: false,
      notes: ["This browser can't decode this video, so no preview, duration or thumbnail could be read."],
    };
  }
  const result: MediaProbe = {
    previewable: true,
    durationSeconds: finite((await resolveDuration(video)) ?? NaN),
    width: finite(video.videoWidth),
    height: finite(video.videoHeight),
    notes,
  };
  if (!result.width) {
    // Audio-only or an undecodable video track.
    result.previewable = false;
    notes.push("No decodable video track was found.");
    return result;
  }

  // Frame rate from presented frames, where the browser supports it.
  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    try {
      const times: number[] = [];
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          const onFrame = (_now: number, meta: { mediaTime: number }) => {
            times.push(meta.mediaTime);
            if (times.length >= 16) resolve();
            else video.requestVideoFrameCallback(onFrame);
          };
          video.requestVideoFrameCallback(onFrame);
          video.play().catch(reject);
        }),
        4000,
      );
      result.frameRate = estimateFrameRate(times);
    } catch {
      // Unknown frame rate is fine; frame stepping then uses 1/30 s steps.
    }
    video.pause();
  }
  if (!result.frameRate) notes.push("Frame rate couldn't be measured.");

  try {
    const at = Math.min(1, (result.durationSeconds ?? 0) * 0.1);
    video.currentTime = at;
    await withTimeout(once(video, "seeked"), 8000);
    result.thumbnail = await canvasToJpeg(video, video.videoWidth, video.videoHeight);
  } catch {
    notes.push("A thumbnail couldn't be captured.");
  }
  return result;
}

async function probeImage(file: File): Promise<MediaProbe> {
  try {
    const bitmap = await withTimeout(createImageBitmap(file));
    const result: MediaProbe = { previewable: true, width: bitmap.width, height: bitmap.height, notes: [] };
    result.thumbnail = await canvasToJpeg(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    return result;
  } catch {
    return {
      previewable: false,
      notes: ["This browser can't display this image format, so no dimensions or thumbnail could be read."],
    };
  }
}

async function probeAudio(url: string): Promise<MediaProbe> {
  const audio = document.createElement("audio");
  audio.preload = "metadata";
  audio.src = url;
  try {
    await withTimeout(once(audio, "loadedmetadata"));
    return { previewable: true, durationSeconds: finite((await resolveDuration(audio)) ?? NaN), notes: [] };
  } catch {
    return {
      previewable: false,
      notes: ["This browser can't play this audio format, so its duration couldn't be read."],
    };
  }
}

/** Reads real metadata (and a thumbnail) from a local file before it is uploaded. */
export async function probeMedia(file: File, kind: AssetKind): Promise<MediaProbe> {
  if (kind === "document") return { previewable: true, notes: [] };
  if (kind === "image") return probeImage(file);
  const url = URL.createObjectURL(file);
  try {
    return kind === "video" ? await probeVideo(url) : await probeAudio(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
