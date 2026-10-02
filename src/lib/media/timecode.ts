/** 83.5 → "1:23", 3725 → "1:02:05". Used for durations and comment markers. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Precise position with milliseconds, e.g. "1:23.450". */
export function formatPreciseTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.000";
  const ms = Math.round((seconds % 1) * 1000) % 1000;
  const base = formatTimecode(seconds + (Math.round((seconds % 1) * 1000) === 1000 ? 1 : 0));
  return `${base}.${String(ms).padStart(3, "0")}`;
}

/** SMPTE-style "HH:MM:SS:FF" when the frame rate is known. */
export function formatFrameTimecode(seconds: number, fps: number): string {
  if (!Number.isFinite(seconds) || seconds < 0 || !(fps > 0)) return "00:00:00:00";
  const rounded = Math.round(fps);
  const totalFrames = Math.floor(seconds * fps + 1e-6);
  const f = totalFrames % rounded;
  const totalSeconds = Math.floor(totalFrames / rounded);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}:${pad(f)}`;
}

/**
 * Parses "83", "1:23", "1:02:05", "1:23.5" into seconds. Returns null for
 * anything else.
 */
export function parseTimecode(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d{1,3})?$/.test(trimmed)) return null;
  const [main, frac = ""] = trimmed.split(".");
  const parts = main.split(":").map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return null;
  const seconds = parts.reduce((acc, p) => acc * 60 + p, 0);
  return seconds + (frac ? Number(`0.${frac}`) : 0);
}

/** One frame earlier/later; falls back to 1/30 s when the frame rate is unknown. */
export function stepFrame(
  current: number,
  direction: 1 | -1,
  fps: number | null | undefined,
  duration?: number | null,
): number {
  const step = 1 / (fps && fps > 0 ? fps : 30);
  const next = current + direction * step;
  const max = duration && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(0, Math.round(next * 1000) / 1000), max);
}

/** Marker position along a timeline, as a percentage clamped to 0–100. */
export function markerPercent(seconds: number, duration: number | null | undefined): number | null {
  if (!duration || duration <= 0 || !Number.isFinite(seconds)) return null;
  return Math.min(100, Math.max(0, (seconds / duration) * 100));
}
