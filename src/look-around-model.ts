export const LOOK_AROUND_DEAD_ZONE_PX = 10;
export const LOOK_AROUND_RESET_DELAY_MS = 30_000;

/** Returns an offset only once a native horizontal scroll has left the deliberate dead zone. */
export function scrollOffsetAfterDeadZone(centerScrollLeft: number, currentScrollLeft: number): number | undefined {
  const offset = currentScrollLeft - centerScrollLeft;
  return Math.abs(offset) > LOOK_AROUND_DEAD_ZONE_PX ? offset : undefined;
}

/** Keeps the calendar's adjacent before/after panes within one viewport width of its start day. */
export function clampLookAroundOffset(offset: number, viewportWidth: number): number {
  return Math.max(-viewportWidth, Math.min(viewportWidth, offset));
}
