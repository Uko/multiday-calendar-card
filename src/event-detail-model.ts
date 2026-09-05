export function eventDetailTitle(summary?: string): string {
  return summary?.trim() || 'Untitled event';
}

/**
 * A location is untrusted calendar data, so it is only ever supplied as an
 * encoded search query rather than interpreted as a URL.
 */
export function locationMapEmbedUrl(location?: string): string | undefined {
  const query = location?.trim();
  if (!query) return undefined;
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}
