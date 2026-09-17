export const LOOK_AROUND_RESET_DELAY_MS = 30_000;
/** Snap to the configured start position only when resting within this distance. */
export const LOOK_AROUND_ORIGIN_SNAP_DISTANCE_PX = 30;
/** Number of rendered dates on each side of the active date window. */
export const LOOK_AROUND_BUFFER_DAYS = 90;
/** Minutes rendered before and after the configured daily time range. */
export const LOOK_AROUND_VERTICAL_BUFFER_MINUTES = 2 * 60;

export const LOOK_AROUND_MODES = ['full', 'horizontal', 'vertical', 'none'] as const;
export type LookAroundMode = typeof LOOK_AROUND_MODES[number];

/** Invalid, omitted, and legacy boolean values deliberately fall back to static mode. */
export function normalizeLookAroundMode(value: unknown): LookAroundMode {
  return typeof value === 'string' && LOOK_AROUND_MODES.includes(value as LookAroundMode)
    ? value as LookAroundMode
    : 'none';
}

export function hasHorizontalLookAround(mode: LookAroundMode): boolean {
  return mode === 'horizontal' || mode === 'full';
}

export function hasVerticalLookAround(mode: LookAroundMode): boolean {
  return mode === 'vertical' || mode === 'full';
}

/** The vertical buffer always spans 22:00 of the prior day through 02:00 of the next. */
export function lookAroundVerticalRange(mode: LookAroundMode, startMinutes: number, endMinutes: number): { startMinutes: number; endMinutes: number } {
  return hasVerticalLookAround(mode)
    ? { startMinutes: -LOOK_AROUND_VERTICAL_BUFFER_MINUTES, endMinutes: 24 * 60 + LOOK_AROUND_VERTICAL_BUFFER_MINUTES }
    : { startMinutes, endMinutes };
}
