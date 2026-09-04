import type { CalendarApiEvent } from './calendar-model';

export type EventDetailDialogParams = {
  calendarName: string;
  event: CalendarApiEvent;
};

type HomeAssistantLike = {
  locale?: { language?: string };
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
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

  showDialog(params: EventDetailDialogParams): void {
    this._params = params;
    this.render();
  }

  closeDialog(): boolean {
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

  private render(): void {
    if (!this._params) return;
    const { calendarName, event } = this._params;
    const locale = this.hass?.locale?.language ?? navigator.language ?? 'en';
    const title = event.summary?.trim() || 'Untitled event';
    const url = event.url ? safeUrl(event.url) : undefined;
    this.innerHTML = `
      <ha-dialog open heading="${escapeHtml(title)}">
        <div class="details">
          <dl>
            <div><dt>When</dt><dd>${escapeHtml(eventDateRange(event, locale))}</dd></div>
            <div><dt>Calendar</dt><dd>${escapeHtml(calendarName)}</dd></div>
            ${event.location?.trim() ? `<div><dt>Location</dt><dd>${escapeHtml(event.location.trim())}</dd></div>` : ''}
          </dl>
          ${event.description?.trim() ? `<section><h3>Description</h3><p>${escapeHtml(event.description.trim())}</p></section>` : ''}
          ${url ? `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open event link</a></p>` : ''}
        </div>
        <button slot="primaryAction" type="button">Close</button>
      </ha-dialog>
      <style>
        .details { min-width: min(420px, 80vw); }
        dl { margin: 0; }
        dl > div { display: grid; grid-template-columns: 6.5rem minmax(0, 1fr); gap: 0.75rem; margin: 0.75rem 0; }
        dt { color: var(--secondary-text-color); }
        dd { margin: 0; overflow-wrap: anywhere; }
        h3 { margin: 1.25rem 0 0.5rem; font-size: 1rem; }
        p { white-space: pre-line; overflow-wrap: anywhere; }
        button { color: var(--primary-color); background: transparent; border: 0; font: inherit; font-weight: 500; cursor: pointer; padding: 8px; }
      </style>
    `;
    this.querySelector('ha-dialog')?.addEventListener('closed', this.onClosed, { once: true });
    this.querySelector('button')?.addEventListener('click', this.onClosed, { once: true });
  }
}

customElements.define('multiday-calendar-event-dialog', MultidayCalendarEventDialog);
