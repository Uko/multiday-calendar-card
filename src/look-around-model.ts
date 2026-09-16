export const LOOK_AROUND_RESET_DELAY_MS = 30_000;
/** Number of rendered dates on each side of the active date window. */
export const LOOK_AROUND_BUFFER_DAYS = 90;
/** Rebuild the virtual date window before the native scroll position reaches an edge. */
export const LOOK_AROUND_RECENTER_MARGIN_DAYS = 12;

export function shouldRecenterLookAround(
  firstVisibleIndex: number,
  bufferDays: number = LOOK_AROUND_BUFFER_DAYS,
  marginDays: number = LOOK_AROUND_RECENTER_MARGIN_DAYS,
): boolean {
  return firstVisibleIndex < marginDays || firstVisibleIndex > bufferDays * 2 - marginDays;
}
