export const CALENDAR_VISUAL_LAYOUT = {
  /** Narrow but sufficient for localized hour labels; prevents a large blank left gutter. */
  axisWidthPx: 40,
  /** Keeps labels clear of the timeline border, matching the graph-card convention. */
  axisLabelGapPx: 10,
  /** Preserve the usual compact card inset on the label side. */
  paddingLeftPx: 12,
  /** Give the timeline the more generous graph-like trailing inset. */
  paddingRightPx: 32,
  /** HA's readable small-text scale (14 px at the default root size). */
  textSizeRem: 0.875,
  /** The header divider must begin at the timeline, never run through time labels. */
  timeAxisHeaderDivider: false,
} as const;

/**
 * Keep the time labels within the axis for either 12- or 24-hour locales while
 * preserving the intended clear gap before the timeline border.
 */
export function timeAxisWidthPx(maxLabelWidthPx: number): number {
  return Math.max(
    CALENDAR_VISUAL_LAYOUT.axisWidthPx,
    Math.ceil(maxLabelWidthPx + CALENDAR_VISUAL_LAYOUT.axisLabelGapPx),
  );
}
