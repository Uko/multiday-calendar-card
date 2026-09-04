import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  DEFAULT_TAP_ACTION,
  normalizeTapAction,
  validateTapAction,
} from '../src/event-interaction';

test('tap action defaults to none and accepts only the initial event actions', () => {
  assert.deepEqual(DEFAULT_TAP_ACTION, { action: 'none' });
  assert.deepEqual(normalizeTapAction(undefined), { action: 'none' });
  assert.deepEqual(normalizeTapAction({ action: 'more-info' }), { action: 'more-info' });
  assert.deepEqual(normalizeTapAction({ action: 'none' }), { action: 'none' });
});

test('tap action rejects malformed and unsupported actions while retaining an extendable action object', () => {
  assert.equal(validateTapAction({ action: 'navigate' }), 'tap_action.action must be "none" or "more-info".');
  assert.equal(validateTapAction('more-info'), 'tap_action must be an action object.');
  assert.equal(validateTapAction({}), 'tap_action.action must be "none" or "more-info".');
  assert.throws(() => normalizeTapAction({ action: 'navigate' }), /tap_action.action must be/);
});
