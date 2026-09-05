export type GeocodedLocation = {
  latitude: number;
  longitude: number;
  boundingBox?: [south: number, north: number, west: number, east: number];
};

type NominatimResult = {
  lat?: string;
  lon?: string;
  boundingbox?: string[];
};

type FetchLike = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

const NOMINATIM_SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

export function eventDetailTitle(summary?: string): string {
  return summary?.trim() || 'Untitled event';
}

export function nominatimSearchUrl(location: string): string {
  const url = new URL(NOMINATIM_SEARCH_ENDPOINT);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', location);
  return url.href;
}

function finiteCoordinate(value: unknown, minimum: number, maximum: number): number | undefined {
  const coordinate = typeof value === 'string' ? Number(value) : undefined;
  return coordinate !== undefined && Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum
    ? coordinate
    : undefined;
}

function parseBoundingBox(value: unknown): GeocodedLocation['boundingBox'] | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const south = finiteCoordinate(value[0], -90, 90);
  const north = finiteCoordinate(value[1], -90, 90);
  const west = finiteCoordinate(value[2], -180, 180);
  const east = finiteCoordinate(value[3], -180, 180);
  return south === undefined || north === undefined || west === undefined || east === undefined || south > north || west > east
    ? undefined
    : [south, north, west, east];
}

export async function geocodeLocation(
  location: string,
  fetcher: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<GeocodedLocation | undefined> {
  const response = await fetcher(nominatimSearchUrl(location), { signal });
  if (!response.ok) return undefined;
  const results = await response.json();
  if (!Array.isArray(results) || !results[0] || typeof results[0] !== 'object') return undefined;
  const result = results[0] as NominatimResult;
  const latitude = finiteCoordinate(result.lat, -90, 90);
  const longitude = finiteCoordinate(result.lon, -180, 180);
  if (latitude === undefined || longitude === undefined) return undefined;
  return { latitude, longitude, boundingBox: parseBoundingBox(result.boundingbox) };
}

export function openStreetMapEmbedUrl(location: GeocodedLocation): string {
  const latitudePadding = 0.006;
  const longitudePadding = 0.01;
  const [south, north, west, east] = location.boundingBox ?? [
    Math.max(-90, location.latitude - latitudePadding),
    Math.min(90, location.latitude + latitudePadding),
    Math.max(-180, location.longitude - longitudePadding),
    Math.min(180, location.longitude + longitudePadding),
  ];
  const url = new URL('https://www.openstreetmap.org/export/embed.html');
  url.searchParams.set('bbox', `${west},${south},${east},${north}`);
  url.searchParams.set('layer', 'mapnik');
  url.searchParams.set('marker', `${location.latitude},${location.longitude}`);
  return url.href;
}
