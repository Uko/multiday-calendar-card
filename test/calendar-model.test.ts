import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  allDayEventPlacementForDay,
  calendarHeaderHeight,
  buildCalendarEventsPath,
  eventPlacementForDay,
  displayTitle,
  eventRangeForDays,
  refreshIntervalMs,
  shouldRefreshAfterVisibility,
  timelineGeometry,
  layoutTimedEventLanes,
  averageEventColors,
} from '../src/calendar-model';

test('buildCalendarEventsPath encodes the calendar entity and date range', () => {
  assert.equal(
    buildCalendarEventsPath(
      'calendar.example schedule',
      new Date('2026-07-28T00:00:00.000Z'),
      new Date('2026-07-30T00:00:00.000Z'),
    ),
    'calendars/calendar.example%20schedule?start=2026-07-28T00%3A00%3A00.000Z&end=2026-07-30T00%3A00%3A00.000Z',
  );
});

test('eventRangeForDays starts at local midnight and ends after the configured day count', () => {
  const range = eventRangeForDays(new Date(2026, 6, 28, 13, 45), 2);

  assert.equal(range.start.getFullYear(), 2026);
  assert.equal(range.start.getMonth(), 6);
  assert.equal(range.start.getDate(), 28);
  assert.equal(range.start.getHours(), 0);
  assert.equal(range.end.getDate(), 30);
  assert.equal(range.end.getHours(), 0);
});

test('eventPlacementForDay clips an event to visible hours within one day', () => {
  const placement = eventPlacementForDay(
    {
      summary: 'Planning',
      start: { dateTime: '2026-07-28T05:30:00.000Z' },
      end: { dateTime: '2026-07-28T07:15:00.000Z' },
    },
    new Date('2026-07-28T00:00:00.000Z'),
    6,
    22,
  );

  assert.deepEqual(placement, {
    summary: 'Planning',
    startMinutes: 360,
    durationMinutes: 75,
  });
});

test('displayTitle omits blank titles but retains meaningful text', () => {
  assert.equal(displayTitle(undefined), undefined);
  assert.equal(displayTitle('   '), undefined);
  assert.equal(displayTitle(' Calendar '), 'Calendar');
});

test('allDayEventPlacementForDay includes date-only events on every covered local day', () => {
  const event = {
    summary: 'Festival',
    start: { date: '2026-07-28' },
    end: { date: '2026-07-30' },
  };

  assert.deepEqual(
    allDayEventPlacementForDay(event, new Date(2026, 6, 28)),
    { summary: 'Festival' },
  );
  assert.deepEqual(
    allDayEventPlacementForDay(event, new Date(2026, 6, 29)),
    { summary: 'Festival' },
  );
  assert.equal(allDayEventPlacementForDay(event, new Date(2026, 6, 30)), undefined);
});

test('allDayEventPlacementForDay excludes timed, malformed, and empty all-day events', () => {
  const day = new Date(2026, 6, 28);

  assert.equal(
    allDayEventPlacementForDay(
      {
        summary: 'Timed event',
        start: { dateTime: '2026-07-28T09:00:00.000Z' },
        end: { dateTime: '2026-07-28T10:00:00.000Z' },
      },
      day,
    ),
    undefined,
  );
  assert.equal(
    allDayEventPlacementForDay(
      { summary: 'Broken', start: { date: '2026-07-30' }, end: { date: '2026-07-28' } },
      day,
    ),
    undefined,
  );
  assert.deepEqual(
    allDayEventPlacementForDay(
      { start: { date: '2026-07-28' }, end: { date: '2026-07-29' } },
      day,
    ),
    { summary: 'Untitled event' },
  );
});

test('calendarHeaderHeight reserves one compact row per all-day event', () => {
  assert.equal(calendarHeaderHeight(0), 38);
  assert.equal(calendarHeaderHeight(1), 60);
  assert.equal(calendarHeaderHeight(3), 104);
});

test('eventPlacementForDay excludes all-day and out-of-day events', () => {
  const day = new Date('2026-07-28T00:00:00.000Z');

  assert.equal(
    eventPlacementForDay(
      {
        summary: 'All day',
        start: { date: '2026-07-28' },
        end: { date: '2026-07-29' },
      },
      day,
      6,
      22,
    ),
    undefined,
  );

  assert.equal(
    eventPlacementForDay(
      {
        summary: 'Tomorrow',
        start: { dateTime: '2026-07-29T09:00:00.000Z' },
        end: { dateTime: '2026-07-29T10:00:00.000Z' },
      },
      day,
      6,
      22,
    ),
    undefined,
  );
});

test('refreshIntervalMs defaults to the Calendar Card Pro 30-minute cadence and permits a valid override', () => {
  assert.equal(refreshIntervalMs(undefined), 30 * 60 * 1000);
  assert.equal(refreshIntervalMs(5), 5 * 60 * 1000);
});

test('refreshIntervalMs rejects non-positive and non-finite intervals', () => {
  assert.throws(() => refreshIntervalMs(0), /positive finite number/);
  assert.throws(() => refreshIntervalMs(-1), /positive finite number/);
  assert.throws(() => refreshIntervalMs(Number.NaN), /positive finite number/);
});

test('shouldRefreshAfterVisibility waits five minutes before refetching a visible card', () => {
  assert.equal(shouldRefreshAfterVisibility(300_000, 0), false);
  assert.equal(shouldRefreshAfterVisibility(300_001, 0), true);
});

test('timelineGeometry preserves the current 56 pixels-per-hour layout without a height limit', () => {
  assert.deepEqual(timelineGeometry(16, 30), {
    fixedHeight: false,
    timelineHeightPx: 896,
    slotHeightPx: 28,
    slotCount: 32,
  });
});

test('timelineGeometry derives timeline geometry from a fixed available height', () => {
  assert.deepEqual(timelineGeometry(16, 30, 400), {
    fixedHeight: true,
    timelineHeightPx: 400,
    slotHeightPx: 12.5,
    slotCount: 32,
  });
});

test('layoutTimedEventLanes gives overlapping events adjacent lanes but lets boundary-touching events reuse a lane', () => {
  const layout = layoutTimedEventLanes([
    { event: 'A', startMinutes: 540, durationMinutes: 60 },
    { event: 'B', startMinutes: 540, durationMinutes: 30 },
    { event: 'C', startMinutes: 570, durationMinutes: 30 },
    { event: 'D', startMinutes: 600, durationMinutes: 30 },
  ], 3);

  assert.deepEqual(layout.events, [
    { event: 'A', startMinutes: 540, durationMinutes: 60, lane: 0, laneCount: 2 },
    { event: 'B', startMinutes: 540, durationMinutes: 30, lane: 1, laneCount: 2 },
    { event: 'C', startMinutes: 570, durationMinutes: 30, lane: 1, laneCount: 2 },
    { event: 'D', startMinutes: 600, durationMinutes: 30, lane: 0, laneCount: 1 },
  ]);
  assert.equal(layout.overflows.length, 0);
});

test('layoutTimedEventLanes keeps max-1 events and summarizes the remaining overlap component when the cap is exceeded', () => {
  const layout = layoutTimedEventLanes([
    { event: 'A', startMinutes: 540, durationMinutes: 60 },
    { event: 'B', startMinutes: 540, durationMinutes: 30 },
    { event: 'C', startMinutes: 540, durationMinutes: 45 },
    { event: 'D', startMinutes: 540, durationMinutes: 15 },
  ], 3);

  assert.deepEqual(layout.events, [
    { event: 'A', startMinutes: 540, durationMinutes: 60, lane: 0, laneCount: 3 },
    { event: 'C', startMinutes: 540, durationMinutes: 45, lane: 1, laneCount: 3 },
  ]);
  assert.deepEqual(layout.overflows, [{
    startMinutes: 540,
    durationMinutes: 30,
    lane: 2,
    laneCount: 3,
    hiddenEvents: ['B', 'D'],
  }]);
});

test('layoutTimedEventLanes displays only the first event in an overlap component when the cap is one', () => {
  const layout = layoutTimedEventLanes([
    { event: 'A', startMinutes: 540, durationMinutes: 60 },
    { event: 'B', startMinutes: 540, durationMinutes: 30 },
  ], 1);

  assert.deepEqual(layout.events, [
    { event: 'A', startMinutes: 540, durationMinutes: 60, lane: 0, laneCount: 1 },
  ]);
  assert.equal(layout.overflows.length, 0);
});

test('averageEventColors averages valid RGB colours and returns undefined when no valid colours exist', () => {
  assert.equal(averageEventColors(['#ff0000', '#0000ff']), '#800080');
  assert.equal(averageEventColors(['invalid']), undefined);
});
