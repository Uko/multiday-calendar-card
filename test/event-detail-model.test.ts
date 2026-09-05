import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  eventDetailTitle,
  geocodeLocation,
  nominatimSearchUrl,
  openStreetMapEmbedUrl,
} from '../src/event-detail-model';

test('event details use the event summary as the dialog title', () => {
  assert.equal(eventDetailTitle('  Team planning  '), 'Team planning');
  assert.equal(eventDetailTitle('  '), 'Untitled event');
  assert.equal(eventDetailTitle(undefined), 'Untitled event');
});

test('Nominatim lookups use a single encoded free-form query', () => {
  const url = new URL(nominatimSearchUrl('Central Station & café'));
  assert.equal(url.origin, 'https://nominatim.openstreetmap.org');
  assert.equal(url.pathname, '/search');
  assert.equal(url.searchParams.get('format'), 'jsonv2');
  assert.equal(url.searchParams.get('limit'), '1');
  assert.equal(url.searchParams.get('q'), 'Central Station & café');
});

test('Nominatim coordinates become an OpenStreetMap marker map', async () => {
  const location = await geocodeLocation('Example venue', async () => ({
    ok: true,
    json: async () => [{
      lat: '52.520008',
      lon: '13.404954',
      boundingbox: ['52.519', '52.521', '13.403', '13.406'],
    }],
  }));
  assert.deepEqual(location, {
    latitude: 52.520008,
    longitude: 13.404954,
    boundingBox: [52.519, 52.521, 13.403, 13.406],
  });
  const url = new URL(openStreetMapEmbedUrl(location!));
  assert.equal(url.origin, 'https://www.openstreetmap.org');
  assert.equal(url.pathname, '/export/embed.html');
  assert.equal(url.searchParams.get('bbox'), '13.403,52.519,13.406,52.521');
  assert.equal(url.searchParams.get('marker'), '52.520008,13.404954');
});

test('invalid Nominatim responses do not create a map', async () => {
  assert.equal(await geocodeLocation('Unknown', async () => ({ ok: true, json: async () => [] })), undefined);
  assert.equal(await geocodeLocation('Unavailable', async () => ({ ok: false, json: async () => [] })), undefined);
  assert.equal(await geocodeLocation('Invalid', async () => ({ ok: true, json: async () => [{ lat: 'no', lon: '13' }] })), undefined);
});
