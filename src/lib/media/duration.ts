/**
 * Some WebM files (e.g. from screen recorders / MediaRecorder) report an
 * infinite duration until the browser has scanned them. Seeking far past the
 * end makes the browser compute the real duration; the position is restored.
 * Resolves with the finite duration, or undefined if it can't be determined.
 */
export function resolveDuration(media: HTMLMediaElement, timeoutMs = 5000): Promise<number | undefined> {
  if (Number.isFinite(media.duration) && media.duration > 0) return Promise.resolve(media.duration);
  return new Promise((resolve) => {
    const restoreTo = media.currentTime;
    const done = (value: number | undefined) => {
      clearTimeout(timer);
      media.removeEventListener("durationchange", onChange);
      media.currentTime = restoreTo;
      resolve(value);
    };
    const onChange = () => {
      if (Number.isFinite(media.duration) && media.duration > 0) done(media.duration);
    };
    const timer = setTimeout(() => done(undefined), timeoutMs);
    media.addEventListener("durationchange", onChange);
    media.currentTime = 1e101;
  });
}
