import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  buildCalendarEventsPath,
  eventPlacementForDay,
  eventRangeForDays,
  timelineGeometry,
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
