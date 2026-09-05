import type { CalendarApiEvent } from './calendar-model';
import {
  eventDetailTitle,
  geocodeLocation,
  openStreetMapEmbedUrl,
} from './event-detail-model';

export type EventDetailDialogParams = {
  calendarName: string;
  calendarColor: string;
  showLocationMap: boolean;
  isDarkTheme: boolean;
  event: CalendarApiEvent;
};

type HomeAssistantLike = {
  locale?: { language?: string };
  themes?: { darkMode?: boolean };
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

function safeCalendarColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : 'var(--primary-color)';
}

function localDate(value: string): Date | undefined {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function eventDateRange(event: CalendarApiEvent, locale: string): string {
  const startValue = event.start.dateTime ?? event.start.date;
  const endValue = event.end.dateTime ?? event.end.date;
  if (!startValue || !endValue) return 'Date unavailable';

  const start = localDate(startValue);
  const end = localDate(endValue);
  if (!start || !end) return 'Date unavailable';

  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const dateTimeFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const allDay = Boolean(event.start.date && event.end.date);
  if (allDay) end.setDate(end.getDate() - 1);

  if (start.toDateString() === end.toDateString()) {
    if (allDay) return dateFormatter.format(start);
    const timeFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    return `${timeFormatter.format(start)} – ${new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(end)}`;
  }
  const formatter = allDay ? dateFormatter : dateTimeFormatter;
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

class MultidayCalendarEventDialog extends HTMLElement {
  public hass?: HomeAssistantLike;
  private _params?: EventDetailDialogParams;
  private _geocodeController?: AbortController;

  showDialog(params: EventDetailDialogParams): void {
    this._geocodeController?.abort();
    this._params = params;
    this.render();
  }

  closeDialog(): boolean {
    this._geocodeController?.abort();
    this._geocodeController = undefined;
    this._params = undefined;
    this.innerHTML = '';
    return true;
  }

  private onClosed = (): void => {
    this.closeDialog();
    this.dispatchEvent(new CustomEvent('dialog-closed', {
      bubbles: true,
      composed: true,
      detail: { dialog: this.localName },
    }));
  };

  private async renderLocationMap(location: string, title: string): Promise<void> {
    const target = this.querySelector<HTMLElement>('[data-map-location]');
    if (!target) return;
    const controller = new AbortController();
    this._geocodeController = controller;
    try {
      const coordinates = await geocodeLocation(location, fetch, controller.signal);
      if (controller.signal.aborted || target !== this.querySelector('[data-map-location]')) return;
      if (!coordinates) {
        target.remove();
        return;
      }
      const mapUrl = openStreetMapEmbedUrl(coordinates);
      const themeClass = this._params?.isDarkTheme ? 'dark-map' : 'light-map';
      target.hidden = false;
      target.innerHTML = `<iframe class="${themeClass}" title="Map for ${escapeHtml(title)}" src="${escapeHtml(mapUrl)}" loading="lazy"></iframe><p class="attribution"><a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p>`;
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return;
      target.remove();
    } finally {
      if (this._geocodeController === controller) this._geocodeController = undefined;
    }
  }

  private render(): void {
    if (!this._params) return;
    const { calendarName, calendarColor, showLocationMap, event } = this._params;
    const locale = this.hass?.locale?.language ?? navigator.language ?? 'en';
    const title = eventDetailTitle(event.summary);
    const location = event.location?.trim();
    const url = event.url ? safeUrl(event.url) : undefined;
    this.innerHTML = `
      <ha-dialog open header-title="${escapeHtml(title)}">
        <div class="details" style="--calendar-color: ${safeCalendarColor(calendarColor)}">
          <dl>
            <div><dt>When</dt><dd>${escapeHtml(eventDateRange(event, locale))}</dd></div>
            <div><dt>Calendar</dt><dd>${escapeHtml(calendarName)}</dd></div>
            ${location ? `<div><dt>Location</dt><dd>${escapeHtml(location)}</dd></div>` : ''}
          </dl>
          ${location && showLocationMap ? '<section class="map" data-map-location hidden></section>' : ''}
          ${event.description?.trim() ? `<section><h3>Description</h3><p>${escapeHtml(event.description.trim())}</p></section>` : ''}
          ${url ? `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open event link</a></p>` : ''}
        </div>
        <button slot="primaryAction" type="button">Close</button>
      </ha-dialog>
      <style>
        .details { min-width: min(420px, 80vw); border-top: 4px solid var(--calendar-color); }
        dl { margin: 0; }
        dl > div { display: grid; grid-template-columns: 6.5rem minmax(0, 1fr); gap: 0.75rem; margin: 0.75rem 0; }
        dt { color: var(--secondary-text-color); }
        dd { margin: 0; overflow-wrap: anywhere; }
        h3 { margin: 1.25rem 0 0.5rem; font-size: 1rem; }
        .map { margin: 1rem 0; }
        .map iframe { display: block; width: 100%; height: 240px; border: 0; border-radius: 8px; }
        .map iframe.dark-map { filter: brightness(0.8) invert(0.9) hue-rotate(180deg) saturate(0.8); }
        .map .attribution { margin: 0.35rem 0 0; font-size: 0.75rem; }
        p { white-space: pre-line; overflow-wrap: anywhere; }
        button { color: var(--primary-color); background: transparent; border: 0; font: inherit; font-weight: 500; cursor: pointer; padding: 8px; }
      </style>
    `;
    this.querySelector('ha-dialog')?.addEventListener('closed', this.onClosed, { once: true });
    this.querySelector('button')?.addEventListener('click', this.onClosed, { once: true });
    if (location && showLocationMap) void this.renderLocationMap(location, title);
  }
}

customElements.define('multiday-calendar-event-dialog', MultidayCalendarEventDialog);
