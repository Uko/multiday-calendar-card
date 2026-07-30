function eventRangeForDays(now, days) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + days);
    return { start, end };
}
function buildCalendarEventsPath(entityId, start, end) {
    const query = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
    });
    return `calendars/${encodeURIComponent(entityId)}?${query.toString()}`;
}
const DEFAULT_PIXELS_PER_HOUR = 56;
function timelineGeometry(visibleHours, slotMinutes, fixedTimelineHeightPx) {
    const fixedHeight = fixedTimelineHeightPx !== undefined;
    const timelineHeightPx = fixedHeight
        ? fixedTimelineHeightPx
        : visibleHours * DEFAULT_PIXELS_PER_HOUR;
    const slotCount = (visibleHours * 60) / slotMinutes;
    return {
        fixedHeight,
        timelineHeightPx,
        slotHeightPx: timelineHeightPx / slotCount,
        slotCount,
    };
}
function eventPlacementForDay(event, day, startHour, endHour) {
    if (!event.start.dateTime || !event.end.dateTime) {
        return undefined;
    }
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return undefined;
    }
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const visibleStart = new Date(dayStart);
    visibleStart.setHours(startHour, 0, 0, 0);
    const visibleEnd = new Date(dayStart);
    visibleEnd.setHours(endHour, 0, 0, 0);
    const clippedStart = new Date(Math.max(start.getTime(), visibleStart.getTime()));
    const clippedEnd = new Date(Math.min(end.getTime(), visibleEnd.getTime(), dayEnd.getTime()));
    if (clippedEnd <= clippedStart) {
        return undefined;
    }
    return {
        summary: event.summary?.trim() || 'Untitled event',
        startMinutes: (clippedStart.getTime() - dayStart.getTime()) / (60 * 1000),
        durationMinutes: (clippedEnd.getTime() - clippedStart.getTime()) / (60 * 1000),
    };
}

const DEFAULT_CONFIG = {
    days: 2,
    start_hour: 6,
    end_hour: 22,
    slot_minutes: 30,
    height: null,
    show_now_line: true,
    calendars: [],
};
function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, (character) => {
        const entities = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;',
        };
        return entities[character];
    });
}
function safeColor(color) {
    return color && /^#[0-9a-f]{6}$/i.test(color) ? color : 'var(--primary-color)';
}
function sameLocalDay(left, right) {
    return (left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate());
}
class MultiDayCalendarCard extends HTMLElement {
    constructor() {
        super(...arguments);
        this._events = [];
        this._loading = false;
    }
    setConfig(config) {
        if (!config?.type) {
            throw new Error('Card config requires a type');
        }
        const startHour = Number(config.start_hour ?? DEFAULT_CONFIG.start_hour);
        const endHour = Number(config.end_hour ?? DEFAULT_CONFIG.end_hour);
        if (!Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || endHour > 24 || startHour >= endHour) {
            throw new Error('start_hour and end_hour must be whole hours from 0 to 24, with start_hour before end_hour');
        }
        const days = Number(config.days ?? DEFAULT_CONFIG.days);
        if (!Number.isInteger(days) || days < 1 || days > 7) {
            throw new Error('days must be a whole number from 1 to 7');
        }
        const slotMinutes = Number(config.slot_minutes ?? DEFAULT_CONFIG.slot_minutes);
        if (!Number.isInteger(slotMinutes) || slotMinutes < 15 || slotMinutes > 60 || 60 % slotMinutes !== 0) {
            throw new Error('slot_minutes must divide one hour and be from 15 to 60');
        }
        const height = config.height ?? DEFAULT_CONFIG.height;
        if (height !== null && (!Number.isFinite(height) || height <= 0)) {
            throw new Error('height must be a positive number of pixels when provided');
        }
        const calendars = config.calendars ?? [];
        if (!calendars.every((calendar) => calendar.entity.startsWith('calendar.'))) {
            throw new Error('Every calendars entry requires a calendar.* entity');
        }
        this._config = {
            ...DEFAULT_CONFIG,
            ...config,
            days,
            start_hour: startHour,
            end_hour: endHour,
            slot_minutes: slotMinutes,
            height,
            calendars,
        };
        this._requestKey = undefined;
        this.render();
        void this.loadEvents();
    }
    set hass(hass) {
        this._hass = hass;
        this.render();
        void this.loadEvents();
    }
    getCardSize() {
        return 8;
    }
    connectedCallback() {
        this.render();
        void this.loadEvents();
    }
    async loadEvents() {
        if (!this._config || !this._hass)
            return;
        const range = eventRangeForDays(new Date(), this._config.days);
        const key = JSON.stringify({
            calendars: this._config.calendars,
            start: range.start.toISOString(),
            end: range.end.toISOString(),
        });
        if (key === this._requestKey)
            return;
        this._requestKey = key;
        this._loading = true;
        this._error = undefined;
        this.render();
        try {
            const eventGroups = await Promise.all(this._config.calendars.map(async (calendar) => ({
                calendar,
                events: await this._hass.callApi('get', buildCalendarEventsPath(calendar.entity, range.start, range.end)),
            })));
            if (this._requestKey !== key)
                return;
            this._events = eventGroups.flatMap(({ calendar, events }) => events.map((event) => ({ calendar, event })));
        }
        catch (error) {
            if (this._requestKey !== key)
                return;
            this._events = [];
            this._error = error instanceof Error ? error.message : 'Unable to load calendar events';
        }
        finally {
            if (this._requestKey === key) {
                this._loading = false;
                this.render();
            }
        }
    }
    render() {
        if (!this._config)
            return;
        const config = this._config;
        const now = new Date();
        const range = eventRangeForDays(now, config.days);
        const locale = this._hass?.locale?.language ?? navigator.language ?? 'en';
        const hourCount = config.end_hour - config.start_hour;
        const minutesVisible = hourCount * 60;
        const geometry = timelineGeometry(hourCount, config.slot_minutes);
        const timelineHeight = geometry.timelineHeightPx;
        const slotHeight = geometry.slotHeightPx;
        const fixedHeight = config.height !== null;
        const dateFormatter = new Intl.DateTimeFormat(locale, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
        });
        const timeFormatter = new Intl.DateTimeFormat(locale, {
            hour: 'numeric',
            minute: '2-digit',
        });
        const days = Array.from({ length: config.days }, (_, index) => {
            const day = new Date(range.start);
            day.setDate(day.getDate() + index);
            return day;
        });
        const timeLabels = Array.from({ length: hourCount + 1 }, (_, index) => {
            const time = new Date(range.start);
            time.setHours(config.start_hour + index, 0, 0, 0);
            const top = fixedHeight ? `${(index / hourCount) * 100}%` : `${index * 56}px`;
            return `<div class="time-label" style="top: ${top}">${escapeHtml(timeFormatter.format(time))}</div>`;
        }).join('');
        const dayColumns = days
            .map((day) => {
            const placements = this._events
                .map(({ calendar, event }) => ({
                calendar,
                placement: eventPlacementForDay(event, day, config.start_hour, config.end_hour),
            }))
                .filter((item) => item.placement !== undefined);
            const events = placements
                .map(({ calendar, placement }) => {
                const top = ((placement.startMinutes - config.start_hour * 60) / minutesVisible) * 100;
                const height = (placement.durationMinutes / minutesVisible) * 100;
                const calendarName = calendar.label ?? calendar.entity;
                return `<div class="event" style="top: ${top}%; height: ${height}%; --event-color: ${safeColor(calendar.color)}" title="${escapeHtml(`${placement.summary} — ${calendarName}`)}">
              <div class="event-summary">${escapeHtml(placement.summary)}</div>
              <div class="event-calendar">${escapeHtml(calendarName)}</div>
            </div>`;
            })
                .join('');
            const isToday = sameLocalDay(day, now);
            const nowLine = config.show_now_line && isToday && now.getHours() >= config.start_hour && now.getHours() < config.end_hour
                ? `<div class="now-line" style="top: ${((now.getHours() * 60 + now.getMinutes() - config.start_hour * 60) / minutesVisible) * 100}%"></div>`
                : '';
            return `<section class="day-column">
          <header class="day-header${isToday ? ' today' : ''}">${escapeHtml(dateFormatter.format(day))}</header>
          <div class="timeline" style="${fixedHeight ? '' : `height: ${timelineHeight}px;`} --slot-height: ${slotHeight}px; --slot-count: ${geometry.slotCount}">
            ${events}${nowLine}
          </div>
        </section>`;
        })
            .join('');
        const title = escapeHtml(config.title ?? 'Multi-day calendar');
        const status = this._loading
            ? '<div class="status">Loading calendar events…</div>'
            : this._error
                ? `<div class="status error">Unable to load calendar events: ${escapeHtml(this._error)}</div>`
                : config.calendars.length === 0
                    ? '<div class="status">Add one or more calendar.* entities in the card configuration.</div>'
                    : this._events.length === 0
                        ? '<div class="status">No timed events in this view.</div>'
                        : '';
        this.innerHTML = `
      <ha-card class="${fixedHeight ? 'fixed-height' : ''}"${fixedHeight ? ` style="height: ${config.height}px"` : ''} header="${title}">
        <div class="wrapper ${fixedHeight ? 'fixed-height' : ''}">
          ${status}
          <div class="schedule ${fixedHeight ? 'fixed-height' : ''}" role="grid" aria-label="${title}">
            <div class="time-axis ${fixedHeight ? 'fixed-height' : ''}"${fixedHeight ? '' : ` style="height: ${timelineHeight + 38}px"`}>
              <div class="time-axis-spacer"></div>
              <div class="time-labels">${timeLabels}</div>
            </div>
            <div class="day-columns ${fixedHeight ? 'fixed-height' : ''}">${dayColumns}</div>
          </div>
        </div>
      </ha-card>
    `;
        const style = document.createElement('style');
        style.textContent = `
      ha-card { display: block; }
      .wrapper { padding: 12px; overflow-x: auto; }
      .wrapper.fixed-height { box-sizing: border-box; height: calc(100% - 56px); display: flex; flex-direction: column; }
      .status { margin: 0 0 10px; color: var(--secondary-text-color); }
      .status.error { color: var(--error-color); }
      .schedule { display: grid; grid-template-columns: 64px minmax(0, 1fr); min-width: 460px; }
      .schedule.fixed-height { flex: 1; min-height: 0; }
      .time-axis { position: relative; color: var(--secondary-text-color); font-size: 0.75rem; }
      .time-axis.fixed-height { height: 100%; }
      .time-axis-spacer { height: 38px; border-bottom: 1px solid var(--divider-color); }
      .time-labels { position: relative; height: calc(100% - 38px); }
      .time-label { position: absolute; right: 8px; transform: translateY(-50%); white-space: nowrap; }
      .time-label:last-child { transform: translateY(-100%); }
      .day-columns { display: grid; grid-template-columns: repeat(${config.days}, minmax(140px, 1fr)); border-left: 1px solid var(--divider-color); }
      .day-columns.fixed-height { height: 100%; }
      .day-column { min-width: 0; border-right: 1px solid var(--divider-color); }
      .day-columns.fixed-height .day-column { display: flex; flex-direction: column; }
      .day-header { height: 37px; display: flex; align-items: center; justify-content: center; border-bottom: 1px solid var(--divider-color); font-weight: 600; font-size: 0.875rem; flex: 0 0 auto; }
      .day-header.today { color: var(--primary-color); }
      .timeline { position: relative; background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--slot-height) - 1px), var(--divider-color) calc(var(--slot-height) - 1px), var(--divider-color) var(--slot-height)); }
      .day-columns.fixed-height .timeline { flex: 1; min-height: 0; background-size: 100% calc(100% / var(--slot-count)); background-repeat: repeat-y; }
      .event { position: absolute; left: 4px; right: 4px; min-height: 18px; box-sizing: border-box; overflow: hidden; border-left: 4px solid var(--event-color); border-radius: 4px; padding: 3px 5px; background: color-mix(in srgb, var(--event-color) 25%, var(--card-background-color)); color: var(--primary-text-color); font-size: 0.75rem; line-height: 1.2; z-index: 1; }
      .event-summary { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .event-calendar { color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .now-line { position: absolute; left: 0; right: 0; height: 2px; background: var(--error-color); z-index: 2; pointer-events: none; }
      @media (max-width: 600px) { .wrapper { padding: 8px; } .schedule { min-width: 380px; grid-template-columns: 52px minmax(0, 1fr); } .time-label { right: 5px; font-size: 0.68rem; } .event-calendar { display: none; } }
    `;
        style.setAttribute('data-multiday-calendar-card', '');
        this.appendChild(style);
    }
}
customElements.define('multiday-calendar-card', MultiDayCalendarCard);
window.customCards = window.customCards || [];
window.customCards.push({
    type: 'multiday-calendar-card',
    name: 'Multiday Calendar Card',
    description: 'Read-only multi-day schedule card for Home Assistant calendars.',
});
//# sourceMappingURL=multiday-calendar-card.js.map
