export type ReviewMarker = { id: string; t: number; resolved: boolean; label: string };
export type ReviewPin = { id: string; x: number; y: number; t: number | null; resolved: boolean; label: string };

/** Imperative controls the comment panel uses to drive the player. */
export type ViewerHandle = {
  seek: (seconds: number) => void;
  pause: () => void;
  currentTime: () => number;
};

export type PinPick = { x: number; y: number };
