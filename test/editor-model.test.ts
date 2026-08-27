import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  editorWarnings,
  formatTime,
  normalizeEditorConfig,
  parseTime,
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

test('time helpers accept standard HH:mm values and preserve the 24:00 end-of-day boundary', () => {
  assert.equal(parseTime('11:30'), 690);
  assert.equal(parseTime('24:00'), 1440);
  assert.equal(parseTime('24:01'), undefined);
  assert.equal(parseTime('9:00'), undefined);
  assert.equal(formatTime(690), '11:30');
});

test('normalizeEditorConfig retains standard time strings unchanged', () => {
  assert.deepEqual(normalizeEditorConfig({
    type: 'custom:multiday-calendar-card',
    start_time: '06:00',
    end_time: '22:00',
  }), {
    type: 'custom:multiday-calendar-card',
    start_time: '06:00',
    end_time: '22:00',
    calendars: [],
  });
});

test('validateEditorConfig accepts arbitrary minute bounds and rejects malformed or reversed times', () => {
  const base = { type: 'custom:multiday-calendar-card', calendars: [{ entity: 'calendar.household' }] };
  assert.deepEqual(validateEditorConfig({ ...base, start_time: '06:15', end_time: '22:45' }), []);
  assert.deepEqual(validateEditorConfig({ ...base, start_time: '6:15', end_time: '22:45' }), [
    'Start time and end time must use the HH:mm format.',
  ]);
  assert.deepEqual(validateEditorConfig({ ...base, start_time: '22:00', end_time: '06:00' }), [
    'Start time must be before end time.',
  ]);
});

test('validateEditorConfig rejects incomplete calendar and invalid view/density values', () => {
  assert.deepEqual(validateEditorConfig({
    type: 'custom:multiday-calendar-card',
    calendars: [],
    days: 8,
    start_time: '20:00',
    end_time: '08:00',
    height: 0,
    max_simultaneous_events: 0,
  }), [
    'Add at least one calendar source.',
    'Days displayed must be a whole number from 1 to 7.',
    'Start time must be before end time.',
    'Fixed height must be a positive number of pixels.',
    'Maximum simultaneous events must be a positive whole number.',
  ]);
});
