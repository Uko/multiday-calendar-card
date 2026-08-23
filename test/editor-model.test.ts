import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  editorWarnings,
  normalizeEditorConfig,
  validateEditorConfig,
} from '../src/editor-model';

test('normalizeEditorConfig preserves unknown and per-calendar future keys while supplying editor defaults', () => {
  const config = normalizeEditorConfig({
    type: 'custom:multiday-calendar-card',
    future_option: 'retain me',
    calendars: [{ entity: 'calendar.household', future_calendar_option: true }],
  });

  assert.deepEqual(config, {
    type: 'custom:multiday-calendar-card',
    future_option: 'retain me',
    calendars: [{ entity: 'calendar.household', future_calendar_option: true }],
  });
});

test('validateEditorConfig permits two sources with identical labels and colors', () => {
  const config = {
    type: 'custom:multiday-calendar-card',
    calendars: [
      { entity: 'calendar.household', label: 'Shared', color: '#4caf50' },
      { entity: 'calendar.personal', label: 'Shared', color: '#4caf50' },
    ],
  };

  assert.deepEqual(validateEditorConfig(config), []);
  assert.deepEqual(editorWarnings(config), [
    'Two or more calendar sources use the label “Shared”.',
    'Two or more calendar sources use the color #4caf50.',
  ]);
});

test('validateEditorConfig accepts the two-hour grid interval and rejects an unsupported interval', () => {
  assert.deepEqual(validateEditorConfig({
    type: 'custom:multiday-calendar-card',
    calendars: [{ entity: 'calendar.household' }],
    slot_minutes: 120,
  }), []);

  assert.deepEqual(validateEditorConfig({
    type: 'custom:multiday-calendar-card',
    calendars: [{ entity: 'calendar.household' }],
    slot_minutes: 45,
  }), ['Grid interval must be 15, 20, 30, 60, or 120 minutes.']);
});

test('validateEditorConfig rejects incomplete calendar and invalid view/density values', () => {
  assert.deepEqual(validateEditorConfig({
    type: 'custom:multiday-calendar-card',
    calendars: [],
    days: 8,
    start_hour: 20,
    end_hour: 8,
    height: 0,
    max_simultaneous_events: 0,
  }), [
    'Add at least one calendar source.',
    'Days displayed must be a whole number from 1 to 7.',
    'Start hour must be before end hour.',
    'Fixed height must be a positive number of pixels.',
    'Maximum simultaneous events must be a positive whole number.',
  ]);
});
