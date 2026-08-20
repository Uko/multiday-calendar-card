import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { CALENDAR_VISUAL_LAYOUT, timeAxisWidthPx } from '../src/visual-layout';

test('calendar visual layout reserves a compact axis and a chart-like right inset', () => {
  assert.equal(CALENDAR_VISUAL_LAYOUT.axisWidthPx, 40);
  assert.equal(CALENDAR_VISUAL_LAYOUT.axisLabelGapPx, 10);
  assert.equal(CALENDAR_VISUAL_LAYOUT.paddingLeftPx, 12);
  assert.equal(CALENDAR_VISUAL_LAYOUT.paddingRightPx, 32);
});

test('calendar visual layout uses readable standard small text and leaves the time-axis header unruled', () => {
  assert.equal(CALENDAR_VISUAL_LAYOUT.textSizeRem, 0.875);
  assert.equal(CALENDAR_VISUAL_LAYOUT.timeAxisHeaderDivider, false);
});

test('timeAxisWidthPx keeps localized labels and their chart clearance inside the axis', () => {
  assert.equal(timeAxisWidthPx(35), 45);
  assert.equal(timeAxisWidthPx(45.4), 56);
  assert.equal(timeAxisWidthPx(10), CALENDAR_VISUAL_LAYOUT.axisWidthPx);
});
