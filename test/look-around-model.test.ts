import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  LOOK_AROUND_BUFFER_DAYS,
  LOOK_AROUND_ORIGIN_SNAP_DISTANCE_PX,
  LOOK_AROUND_RESET_DELAY_MS,
  LOOK_AROUND_VERTICAL_BUFFER_MINUTES,
  hasHorizontalLookAround,
  hasVerticalLookAround,
  lookAroundVerticalRange,
  normalizeLookAroundMode,
  rawScrollToCalendarPoint,
  calendarPointToRawScroll,
  rebaseRawScrollForGeometry,
} from '../src/look-around-model';

test('look-around waits 30 seconds after horizontal scrolling before returning to its start-day position', () => {
  assert.equal(LOOK_AROUND_RESET_DELAY_MS, 30_000);
  assert.equal(LOOK_AROUND_ORIGIN_SNAP_DISTANCE_PX, 30);
});

test('look-around keeps a large fixed virtual date buffer around the configured start day', () => {
  assert.equal(LOOK_AROUND_BUFFER_DAYS, 90);
});

test('calendar and raw scroll coordinates are exact inverses around the display-start origin', () => {
  const geometry = {
    originRawScroll: { left: 12_480.25, top: 316.5 },
    dayWidthPx: 241.75,
    pixelsPerMinute: 1.125,
  };
  const calendarPoint = { x: 0.5, y: 45 };

  const raw = calendarPointToRawScroll(calendarPoint, geometry);
  assert.deepEqual(raw, { left: 12_601.125, top: 367.125 });
  assert.deepEqual(rawScrollToCalendarPoint(raw, geometry), calendarPoint);
  assert.deepEqual(rawScrollToCalendarPoint(geometry.originRawScroll, geometry), { x: 0, y: 0 });
});

test('header geometry change preserves the display-start origin at calendar point zero', () => {
  const beforeHeaderChange = {
    originRawScroll: { left: 12_480.25, top: 316.5 },
    dayWidthPx: 241.75,
    pixelsPerMinute: 0.9,
  };
  const afterHeaderChange = {
    originRawScroll: { left: 12_480.25, top: 360.5 },
    dayWidthPx: 241.75,
    pixelsPerMinute: 0.85,
  };

  const rawAfterHeaderChange = rebaseRawScrollForGeometry(
    beforeHeaderChange.originRawScroll,
    beforeHeaderChange,
    afterHeaderChange,
  );

  assert.deepEqual(rawAfterHeaderChange, afterHeaderChange.originRawScroll);
  assert.deepEqual(rawScrollToCalendarPoint(rawAfterHeaderChange, afterHeaderChange), { x: 0, y: 0 });
});

test('look-around modes default invalid input to static and independently select axes', () => {
  assert.equal(LOOK_AROUND_VERTICAL_BUFFER_MINUTES, 120);
  assert.equal(normalizeLookAroundMode(undefined), 'none');
  assert.equal(normalizeLookAroundMode(true), 'none');
  assert.equal(normalizeLookAroundMode('unexpected'), 'none');
  assert.equal(normalizeLookAroundMode('horizontal'), 'horizontal');
  assert.equal(hasHorizontalLookAround('horizontal'), true);
  assert.equal(hasVerticalLookAround('horizontal'), false);
  assert.equal(hasHorizontalLookAround('vertical'), false);
  assert.equal(hasVerticalLookAround('vertical'), true);
  assert.equal(hasHorizontalLookAround('full'), true);
  assert.equal(hasVerticalLookAround('full'), true);
  assert.deepEqual(lookAroundVerticalRange('vertical', 360, 1320), { startMinutes: -120, endMinutes: 1560 });
  assert.deepEqual(lookAroundVerticalRange('full', 0, 1440), { startMinutes: -120, endMinutes: 1560 });
  assert.deepEqual(lookAroundVerticalRange('none', 360, 1320), { startMinutes: 360, endMinutes: 1320 });
});