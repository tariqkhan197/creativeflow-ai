const COMMON_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];

/**
 * Estimates frames per second from consecutive presented-frame media times
 * (requestVideoFrameCallback metadata.mediaTime). Returns undefined when the
 * samples are too few or too irregular to be trustworthy.
 */
export function estimateFrameRate(mediaTimes: number[]): number | undefined {
  const deltas: number[] = [];
  for (let i = 1; i < mediaTimes.length; i++) {
    const d = mediaTimes[i] - mediaTimes[i - 1];
    if (d > 0.001 && d < 0.5) deltas.push(d);
  }
  if (deltas.length < 4) return undefined;
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // Dropped frames show up as multiples of the frame duration; ignore them.
  const consistent = deltas.filter((d) => Math.abs(d - median) / median < 0.15);
  if (consistent.length < Math.max(3, deltas.length * 0.5)) return undefined;
  const fps = 1 / (consistent.reduce((a, b) => a + b, 0) / consistent.length);
  // Snap to the nearest common rate (24 vs 23.976 differ by only 0.1%).
  const nearest = COMMON_RATES.reduce((best, r) => (Math.abs(r - fps) < Math.abs(best - fps) ? r : best));
  return Math.abs(nearest - fps) / nearest < 0.0005 ? nearest : Math.round(fps * 1000) / 1000;
}
