export type Rect = { x: number; y: number; width: number; height: number };

/**
 * The area actually covered by media rendered with `object-fit: contain`
 * inside a box (letterboxing removed). Falls back to the whole box when the
 * media size is unknown.
 */
export function containedRect(boxWidth: number, boxHeight: number, mediaWidth?: number, mediaHeight?: number): Rect {
  if (!mediaWidth || !mediaHeight || boxWidth <= 0 || boxHeight <= 0) {
    return { x: 0, y: 0, width: Math.max(0, boxWidth), height: Math.max(0, boxHeight) };
  }
  const scale = Math.min(boxWidth / mediaWidth, boxHeight / mediaHeight);
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const width = r(mediaWidth * scale);
  const height = r(mediaHeight * scale);
  return { x: r((boxWidth - width) / 2), y: r((boxHeight - height) / 2), width, height };
}

/** Click position (relative to the box) → normalized frame coordinates, or null outside the frame. */
export function toNormalizedPoint(px: number, py: number, frame: Rect): { x: number; y: number } | null {
  if (frame.width <= 0 || frame.height <= 0) return null;
  const x = (px - frame.x) / frame.width;
  const y = (py - frame.y) / frame.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return { x: round(x), y: round(y) };
}

/** Normalized point → position in the box, in pixels. */
export function fromNormalizedPoint(point: { x: number; y: number }, frame: Rect): { left: number; top: number } {
  return { left: frame.x + point.x * frame.width, top: frame.y + point.y * frame.height };
}

/** Pins shown at the current playback position (within half a second), or always for stills. */
export function isPinVisible(pinTime: number | null, currentTime: number, window = 0.5): boolean {
  return pinTime === null || Math.abs(pinTime - currentTime) <= window;
}
