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

test('validateEditorConfig accepts two-letter skip_days and rejects invalid or all-day selections', () => {
  const base = { type: 'custom:multiday-calendar-card', calendars: [{ entity: 'calendar.household' }] };

  assert.deepEqual(validateEditorConfig({ ...base, skip_days: ['sa', 'su'] }), []);
  assert.deepEqual(validateEditorConfig({ ...base, skip_days: ['sat'] }), [
    'Skip days must be a list containing only mo, tu, we, th, fr, sa, or su.',
  ]);
  assert.deepEqual(validateEditorConfig({ ...base, skip_days: ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'] }), [
    'Skip days cannot include every day of the week.',
  ]);
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

test('validateEditorConfig accepts an optional start_day_entity and rejects an empty one', () => {
  const base = { type: 'custom:multiday-calendar-card', calendars: [{ entity: 'calendar.household' }] };

  assert.deepEqual(validateEditorConfig({ ...base, start_day_entity: 'input_datetime.calendar_start' }), []);
  assert.deepEqual(validateEditorConfig({ ...base, start_day_entity: '   ' }), [
    'Start day entity must be a non-empty entity ID.',
  ]);
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

test('validateEditorConfig validates hour height only when fixed packing is disabled', () => {
  const base = { type: 'custom:multiday-calendar-card', calendars: [{ entity: 'calendar.household' }] };

  assert.deepEqual(validateEditorConfig({ ...base, hour_height: 0 }), [
    'Hour height must be a positive number of pixels.',
  ]);
  assert.deepEqual(validateEditorConfig({ ...base, height: 480, hour_height: 0 }), []);
});

test('validateEditorConfig accepts event more-info taps and rejects unsupported actions', () => {
  const base = { type: 'custom:multiday-calendar-card', calendars: [{ entity: 'calendar.household' }] };

  assert.deepEqual(validateEditorConfig({ ...base, tap_action: { action: 'more-info' } }), []);
  assert.deepEqual(validateEditorConfig({ ...base, tap_action: { action: 'navigate' } }), [
    'tap_action.action must be "none" or "more-info".',
  ]);
});

test('validateEditorConfig requires the optional location map setting to be boolean', () => {
  const base = { type: 'custom:multiday-calendar-card', calendars: [{ entity: 'calendar.household' }] };

  assert.deepEqual(validateEditorConfig({ ...base, show_location_map: false }), []);
  assert.deepEqual(validateEditorConfig({ ...base, show_location_map: 'yes' }), [
    'Show location map must be true or false.',
  ]);
});

test('validateEditorConfig accepts a known location-map provider and rejects unsafe provider settings', () => {
  const base = { type: 'custom:multiday-calendar-card', calendars: [{ entity: 'calendar.household' }] };

  assert.deepEqual(validateEditorConfig({
    ...base,
    show_location_map: true,
    location_map_provider: 'osm_nominatim',
    custom_nominatim_url: 'https://maps.example.test/search',
  }), []);
  assert.deepEqual(validateEditorConfig({ ...base, location_map_provider: 'apple' }), [
    'Map provider must be Google Maps or OpenStreetMap + Nominatim.',
  ]);
  assert.deepEqual(validateEditorConfig({ ...base, custom_nominatim_url: 'not-a-url' }), [
    'Custom Nominatim URL must be an absolute HTTP(S) URL.',
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
