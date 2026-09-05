import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { eventDetailTitle, locationMapEmbedUrl } from '../src/event-detail-model';

test('event details use the event summary as the dialog title', () => {
  assert.equal(eventDetailTitle('  Team planning  '), 'Team planning');
  assert.equal(eventDetailTitle('  '), 'Untitled event');
  assert.equal(eventDetailTitle(undefined), 'Untitled event');
});

test('event detail map embeds use encoded location search queries', () => {
  assert.equal(
    locationMapEmbedUrl('Central Station & café'),
    'https://www.google.com/maps?q=Central%20Station%20%26%20caf%C3%A9&output=embed',
  );
  assert.equal(locationMapEmbedUrl('  '), undefined);
  assert.equal(locationMapEmbedUrl(undefined), undefined);
});
