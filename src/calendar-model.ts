export type CalendarApiEvent = {
  summary?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
};

export const CALENDAR_DAY_NAME_HEIGHT_PX = 38;
export const ALL_DAY_EVENT_ROW_HEIGHT_PX = 22;

export function calendarHeaderHeight(allDayEventCount: number): number {
  return CALENDAR_DAY_NAME_HEIGHT_PX + allDayEventCount * ALL_DAY_EVENT_ROW_HEIGHT_PX;
}

export type EventPlacement = {
  summary: string;
  startMinutes: number;
  durationMinutes: number;
};

export type AllDayEventPlacement = {
  summary: string;
};

export type TimedEventLaneInput<T> = {
  event: T;
  startMinutes: number;
  durationMinutes: number;
};

export type TimedEventLane<T> = TimedEventLaneInput<T> & {
  lane: number;
  laneCount: number;
};

export type TimedEventOverflow<T> = {
  startMinutes: number;
  durationMinutes: number;
  lane: number;
  laneCount: number;
  hiddenEvents: T[];
};

export type TimedEventLaneLayout<T> = {
  events: TimedEventLane<T>[];
  overflows: TimedEventOverflow<T>[];
};

function eventEndMinutes<T>(event: TimedEventLaneInput<T>): number {
  return event.startMinutes + event.durationMinutes;
}

function laneEvents<T>(events: TimedEventLaneInput<T>[], laneCount: number): TimedEventLane<T>[] {
  const laneEnds: number[] = [];

  return events.map((event) => {
    let lane = laneEnds.findIndex((endMinutes) => endMinutes <= event.startMinutes);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = eventEndMinutes(event);
    return { ...event, lane, laneCount };
  });
}

/**
 * Arrange connected timed-event overlap groups into lanes. If a group needs more
 * lanes than maxSimultaneousEvents, retain max-1 real events and replace the rest
 * with one summary event spanning their combined time range. A cap of one omits
 * the remaining events as requested.
 */
export function layoutTimedEventLanes<T>(
  events: TimedEventLaneInput<T>[],
  maxSimultaneousEvents: number,
): TimedEventLaneLayout<T> {
  if (!Number.isInteger(maxSimultaneousEvents) || maxSimultaneousEvents < 1) {
    throw new Error('maxSimultaneousEvents must be a positive whole number');
  }

  const sorted = [...events].sort((left, right) =>
    left.startMinutes - right.startMinutes ||
    eventEndMinutes(right) - eventEndMinutes(left),
  );
  const components: TimedEventLaneInput<T>[][] = [];
  let component: TimedEventLaneInput<T>[] = [];
  let componentEnd = -Infinity;

  for (const event of sorted) {
    if (component.length > 0 && event.startMinutes >= componentEnd) {
      components.push(component);
      component = [];
      componentEnd = -Infinity;
    }
    component.push(event);
    componentEnd = Math.max(componentEnd, eventEndMinutes(event));
  }
  if (component.length > 0) components.push(component);

  const laidOutEvents: TimedEventLane<T>[] = [];
  const overflows: TimedEventOverflow<T>[] = [];
  for (const overlapGroup of components) {
    const fullyLaidOut = laneEvents(overlapGroup, overlapGroup.length);
    const requiredLanes = Math.max(...fullyLaidOut.map((event) => event.lane + 1));
    if (requiredLanes <= maxSimultaneousEvents) {
      laidOutEvents.push(...laneEvents(overlapGroup, requiredLanes));
      continue;
    }

    if (maxSimultaneousEvents === 1) {
      laidOutEvents.push(...laneEvents(overlapGroup.slice(0, 1), 1));
      continue;
    }

    const visibleEvents = overlapGroup.slice(0, maxSimultaneousEvents - 1);
    const hiddenEvents = overlapGroup.slice(maxSimultaneousEvents - 1);
    laidOutEvents.push(...laneEvents(visibleEvents, maxSimultaneousEvents));
    const hiddenStart = Math.min(...hiddenEvents.map((event) => event.startMinutes));
    const hiddenEnd = Math.max(...hiddenEvents.map(eventEndMinutes));
    overflows.push({
      startMinutes: hiddenStart,
      durationMinutes: hiddenEnd - hiddenStart,
      lane: maxSimultaneousEvents - 1,
      laneCount: maxSimultaneousEvents,
      hiddenEvents: hiddenEvents.map((event) => event.event),
    });
  }

  return { events: laidOutEvents, overflows };
}

export function averageEventColors(colors: string[]): string | undefined {
  const rgbValues = colors
    .map((color) => /^#([0-9a-f]{6})$/i.exec(color)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((hex) => [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ]);
  if (rgbValues.length === 0) return undefined;

  const average = (index: number): string =>
    Math.round(rgbValues.reduce((sum, rgb) => sum + rgb[index], 0) / rgbValues.length)
      .toString(16)
      .padStart(2, '0');
  return `#${average(0)}${average(1)}${average(2)}`;
}

function localDateFromIsoDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
    ? date
    : undefined;
}

export function allDayEventPlacementForDay(
  event: CalendarApiEvent,
  day: Date,
): AllDayEventPlacement | undefined {
  if (!event.start.date || !event.end.date) return undefined;

  const start = localDateFromIsoDate(event.start.date);
  const end = localDateFromIsoDate(event.end.date);
  if (!start || !end || end <= start) return undefined;

  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  if (dayStart < start || dayStart >= end) return undefined;

  return { summary: event.summary?.trim() || 'Untitled event' };
}

export function eventRangeForDays(now: Date, days: number): {
  start: Date;
  end: Date;
} {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + days);

  return { start, end };
}

export function buildCalendarEventsPath(
  entityId: string,
  start: Date,
  end: Date,
): string {
  const query = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
  });
  return `calendars/${encodeURIComponent(entityId)}?${query.toString()}`;
}

export const DEFAULT_REFRESH_INTERVAL_MINUTES = 30;
export const VISIBILITY_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

export function refreshIntervalMs(intervalMinutes: number | undefined): number {
  const minutes = intervalMinutes ?? DEFAULT_REFRESH_INTERVAL_MINUTES;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('refresh_interval must be a positive finite number of minutes');
  }
  return minutes * 60 * 1000;
}

export function shouldRefreshAfterVisibility(nowMs: number, lastUpdateMs: number): boolean {
  return nowMs - lastUpdateMs > VISIBILITY_REFRESH_THRESHOLD_MS;
}

export type TimelineGeometry = {
  fixedHeight: boolean;
  timelineHeightPx: number;
  slotHeightPx: number;
  slotCount: number;
};

const DEFAULT_PIXELS_PER_HOUR = 56;

export function timelineGeometry(
  visibleHours: number,
  slotMinutes: number,
  fixedTimelineHeightPx?: number,
): TimelineGeometry {
  const fixedHeight = fixedTimelineHeightPx !== undefined;
  const timelineHeightPx = fixedHeight
    ? fixedTimelineHeightPx
    : visibleHours * DEFAULT_PIXELS_PER_HOUR;
  const slotCount = (visibleHours * 60) / slotMinutes;

  return {
    fixedHeight,
    timelineHeightPx,
    slotHeightPx: timelineHeightPx / slotCount,
    slotCount,
  };
}

export function displayTitle(title: string | undefined): string | undefined {
  const trimmed = title?.trim();
  return trimmed || undefined;
}

export function eventPlacementForDay(
  event: CalendarApiEvent,
  day: Date,
  startHour: number,
  endHour: number,
): EventPlacement | undefined {
  if (!event.start.dateTime || !event.end.dateTime) {
    return undefined;
  }

  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return undefined;
  }

  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const visibleStart = new Date(dayStart);
  visibleStart.setHours(startHour, 0, 0, 0);
  const visibleEnd = new Date(dayStart);
  visibleEnd.setHours(endHour, 0, 0, 0);

  const clippedStart = new Date(Math.max(start.getTime(), visibleStart.getTime()));
  const clippedEnd = new Date(
    Math.min(end.getTime(), visibleEnd.getTime(), dayEnd.getTime()),
  );
  if (clippedEnd <= clippedStart) {
    return undefined;
  }

  return {
    summary: event.summary?.trim() || 'Untitled event',
    startMinutes:
      (clippedStart.getTime() - dayStart.getTime()) / (60 * 1000),
    durationMinutes: (clippedEnd.getTime() - clippedStart.getTime()) / (60 * 1000),
  };
}
