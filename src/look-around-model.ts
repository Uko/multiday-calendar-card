export const LOOK_AROUND_RESET_DELAY_MS = 30_000;
/** Number of rendered dates on each side of the active date window. */
export const LOOK_AROUND_BUFFER_DAYS = 90;
/** Rebuild the virtual date window before the native scroll position reaches an edge. */
export const LOOK_AROUND_RECENTER_MARGIN_DAYS = 12;
/** Portion of a day column needed to release the current magnetic snap. */
export const LOOK_AROUND_SNAP_RELEASE_RATIO = 0.35;

export function snapStepForScrollOffset(
  offset: number,
  dayWidth: number,
  releaseRatio: number = LOOK_AROUND_SNAP_RELEASE_RATIO,
): -1 | 0 | 1 {
  const releaseDistance = dayWidth * releaseRatio;
  if (offset >= releaseDistance) return 1;
  if (offset <= -releaseDistance) return -1;
  return 0;
}

export function shouldRecenterLookAround(
  firstVisibleIndex: number,
  bufferDays: number = LOOK_AROUND_BUFFER_DAYS,
  marginDays: number = LOOK_AROUND_RECENTER_MARGIN_DAYS,
): boolean {
  return firstVisibleIndex < marginDays || firstVisibleIndex > bufferDays * 2 - marginDays;
}
