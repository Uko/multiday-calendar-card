import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  LOOK_AROUND_BUFFER_DAYS,
  LOOK_AROUND_ORIGIN_SNAP_DISTANCE_PX,
  LOOK_AROUND_RECENTER_MARGIN_DAYS,
  LOOK_AROUND_RESET_DELAY_MS,
  shouldRecenterLookAround,
} from '../src/look-around-model';

test('look-around waits 30 seconds after horizontal scrolling before returning to its start-day position', () => {
  assert.equal(LOOK_AROUND_RESET_DELAY_MS, 30_000);
  assert.equal(LOOK_AROUND_ORIGIN_SNAP_DISTANCE_PX, 20);
});

test('look-around keeps a large virtual date buffer and recenters before the user reaches an edge', () => {
  assert.equal(LOOK_AROUND_BUFFER_DAYS, 90);
  assert.equal(LOOK_AROUND_RECENTER_MARGIN_DAYS, 12);
  assert.equal(shouldRecenterLookAround(11), true);
  assert.equal(shouldRecenterLookAround(12), false);
  assert.equal(shouldRecenterLookAround(90), false);
  assert.equal(shouldRecenterLookAround(169), true);
});