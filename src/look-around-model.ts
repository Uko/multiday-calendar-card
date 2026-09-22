export type CalendarScrollPoint = {
  /** Continuous displayed-day distance from the first visible, non-skipped day. */
  x: number;
  /** Continuous minute distance from the configured start time. */
  y: number;
};

export type RawScrollPoint = { left: number; top: number };

/** Geometry that maps the semantic display-start origin onto the native scrollport. */
export type CalendarScrollGeometry = {
  originRawScroll: RawScrollPoint;
  dayWidthPx: number;
  pixelsPerMinute: number;
};

/** Convert the browser's native scroll coordinates into semantic calendar coordinates. */
export function rawScrollToCalendarPoint(raw: RawScrollPoint, geometry: CalendarScrollGeometry): CalendarScrollPoint {
  return {
    x: (raw.left - geometry.originRawScroll.left) / geometry.dayWidthPx,
    y: (raw.top - geometry.originRawScroll.top) / geometry.pixelsPerMinute,
  };
}

/** Convert semantic calendar coordinates into the browser's native scroll coordinates. */
export function calendarPointToRawScroll(point: CalendarScrollPoint, geometry: CalendarScrollGeometry): RawScrollPoint {
  return {
    left: geometry.originRawScroll.left + point.x * geometry.dayWidthPx,
    top: geometry.originRawScroll.top + point.y * geometry.pixelsPerMinute,
  };
}

/** Preserve a semantic calendar point while the header or timeline geometry changes. */
export function rebaseRawScrollForGeometry(
  raw: RawScrollPoint,
  previous: CalendarScrollGeometry,
  next: CalendarScrollGeometry,
): RawScrollPoint {
  return calendarPointToRawScroll(rawScrollToCalendarPoint(raw, previous), next);
}

export const LOOK_AROUND_RESET_DELAY_MS = 30_000;
/** Snap to the configured start position only when resting within this distance. */
export const LOOK_AROUND_ORIGIN_SNAP_DISTANCE_PX = 30;
/** Number of rendered dates on each side of the active date window. */
export const LOOK_AROUND_BUFFER_DAYS = 90;
/** Minutes rendered before and after the configured daily time range. */
export const LOOK_AROUND_VERTICAL_BUFFER_MINUTES = 2 * 60;

export const LOOK_AROUND_MODES = ['full', 'horizontal', 'vertical', 'none'] as const;
export type LookAroundMode = typeof LOOK_AROUND_MODES[number];

/** User-facing YAML shape. */
export type LookAroundSettings = {
  mode?: LookAroundMode;
  /** Pixels of accumulated input required to release the configured origin. Zero disables origin snapping. */
  origin_snap_distance?: number;
  /** Seconds before returning to the configured origin. Zero disables automatic re-centering. */
  automatic_recenter?: number;
};

export type LookAroundConfig = LookAroundSettings;

export type NormalizedLookAroundSettings = Required<LookAroundSettings>;

/** Invalid or omitted modes resolve to the static view. */
export function normalizeLookAroundMode(value: unknown): LookAroundMode {
  return typeof value === 'string' && LOOK_AROUND_MODES.includes(value as LookAroundMode)
    ? value as LookAroundMode
    : 'none';
}

/** Normalize the nested configuration into runtime defaults. */
export function normalizeLookAroundSettings(value: unknown): NormalizedLookAroundSettings {
  const settings = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  const originSnapDistance = settings?.origin_snap_distance;
  const automaticRecenter = settings?.automatic_recenter;
  return {
    mode: normalizeLookAroundMode(settings?.mode),
    origin_snap_distance: typeof originSnapDistance === 'number' && Number.isFinite(originSnapDistance) && originSnapDistance >= 0
      ? originSnapDistance
      : LOOK_AROUND_ORIGIN_SNAP_DISTANCE_PX,
    automatic_recenter: typeof automaticRecenter === 'number' && Number.isFinite(automaticRecenter) && automaticRecenter >= 0
      ? automaticRecenter
      : LOOK_AROUND_RESET_DELAY_MS / 1_000,
  };
}

/** Validate the nested YAML configuration. */
export function validateLookAroundSettings(value: unknown): string[] {
  if (value === undefined) return [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return ['Look around must be an object with mode, origin_snap_distance, and automatic_recenter.'];
  }
  const settings = value as Record<string, unknown>;
  const errors: string[] = [];
  if (settings.mode !== undefined && normalizeLookAroundMode(settings.mode) === 'none' && settings.mode !== 'none') {
    errors.push('Look around mode must be none, horizontal, vertical, or full.');
  }
  if (settings.origin_snap_distance !== undefined &&
      (typeof settings.origin_snap_distance !== 'number' || !Number.isFinite(settings.origin_snap_distance) || settings.origin_snap_distance < 0)) {
    errors.push('Origin snap distance must be a non-negative number of pixels.');
  }
  if (settings.automatic_recenter !== undefined &&
      (typeof settings.automatic_recenter !== 'number' || !Number.isFinite(settings.automatic_recenter) || settings.automatic_recenter < 0)) {
    errors.push('Automatic recenter must be a non-negative number of seconds.');
  }
  return errors;
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
