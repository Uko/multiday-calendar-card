import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  LOOK_AROUND_DEAD_ZONE_PX,
  LOOK_AROUND_RESET_DELAY_MS,
  clampLookAroundOffset,
  scrollOffsetAfterDeadZone,
} from '../src/look-around-model';

test('look-around ignores small native scroll movement until it passes the 10px dead zone', () => {
  assert.equal(LOOK_AROUND_DEAD_ZONE_PX, 10);
  assert.equal(scrollOffsetAfterDeadZone(200, 209), undefined);
  assert.equal(scrollOffsetAfterDeadZone(200, 190), undefined);
  assert.equal(scrollOffsetAfterDeadZone(200, 210), undefined);
  assert.equal(scrollOffsetAfterDeadZone(200, 211), 11);
  assert.equal(scrollOffsetAfterDeadZone(200, 189), -11);
});

test('look-around waits 30 seconds after a horizontal scroll before returning to its start-day position', () => {
  assert.equal(LOOK_AROUND_RESET_DELAY_MS, 30_000);
});

test('look-around keeps the adjacent blank date grids within one viewport width', () => {
  assert.equal(clampLookAroundOffset(-900, 320), -320);
  assert.equal(clampLookAroundOffset(120, 320), 120);
  assert.equal(clampLookAroundOffset(900, 320), 320);
});
