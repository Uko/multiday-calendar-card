const CALENDAR_DAY_NAME_HEIGHT_PX = 38;
const ALL_DAY_EVENT_ROW_HEIGHT_PX = 22;
function calendarHeaderHeight(allDayEventCount) {
    return CALENDAR_DAY_NAME_HEIGHT_PX + allDayEventCount * ALL_DAY_EVENT_ROW_HEIGHT_PX;
}
function eventEndMinutes(event) {
    return event.startMinutes + event.durationMinutes;
}
function laneEvents(events, laneCount) {
    const laneEnds = [];
    return events.map((event) => {
        let lane = laneEnds.findIndex((endMinutes) => endMinutes <= event.startMinutes);
        if (lane < 0)
            lane = laneEnds.length;
        laneEnds[lane] = eventEndMinutes(event);
        return { ...event, lane, laneCount };
    });
}
/**
 * Arrange connected timed-event overlap groups into lanes. If a group needs more
 * lanes than maxSimultaneousEvents, retain max-1 real events and replace the rest
 * with one summary event spanning their combined time range. A cap of one omits
 * the remaining events as requested.
 */
function layoutTimedEventLanes(events, maxSimultaneousEvents) {
    if (!Number.isInteger(maxSimultaneousEvents) || maxSimultaneousEvents < 1) {
        throw new Error('maxSimultaneousEvents must be a positive whole number');
    }
    const sorted = [...events].sort((left, right) => left.startMinutes - right.startMinutes ||
        eventEndMinutes(right) - eventEndMinutes(left));
    const components = [];
    let component = [];
    let componentEnd = -Infinity;
    for (const event of sorted) {
        if (component.length > 0 && event.startMinutes >= componentEnd) {
            components.push(component);
            component = [];
            componentEnd = -Infinity;
        }
        component.push(event);
        componentEnd = Math.max(componentEnd, eventEndMinutes(event));
    }
    if (component.length > 0)
        components.push(component);
    const laidOutEvents = [];
    const overflows = [];
    for (const overlapGroup of components) {
        const fullyLaidOut = laneEvents(overlapGroup, overlapGroup.length);
        const requiredLanes = Math.max(...fullyLaidOut.map((event) => event.lane + 1));
        if (requiredLanes <= maxSimultaneousEvents) {
            laidOutEvents.push(...laneEvents(overlapGroup, requiredLanes));
            continue;
        }
        if (maxSimultaneousEvents === 1) {
            laidOutEvents.push(...laneEvents(overlapGroup.slice(0, 1), 1));
            continue;
        }
        const visibleEvents = overlapGroup.slice(0, maxSimultaneousEvents - 1);
        const hiddenEvents = overlapGroup.slice(maxSimultaneousEvents - 1);
        laidOutEvents.push(...laneEvents(visibleEvents, maxSimultaneousEvents));
        const hiddenStart = Math.min(...hiddenEvents.map((event) => event.startMinutes));
        const hiddenEnd = Math.max(...hiddenEvents.map(eventEndMinutes));
        overflows.push({
            startMinutes: hiddenStart,
            durationMinutes: hiddenEnd - hiddenStart,
            lane: maxSimultaneousEvents - 1,
            laneCount: maxSimultaneousEvents,
            hiddenEvents: hiddenEvents.map((event) => event.event),
        });
    }
    return { events: laidOutEvents, overflows };
}
function averageEventColors(colors) {
    const rgbValues = colors
        .map((color) => /^#([0-9a-f]{6})$/i.exec(color)?.[1])
        .filter((value) => value !== undefined)
        .map((hex) => [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
    ]);
    if (rgbValues.length === 0)
        return undefined;
    const average = (index) => Math.round(rgbValues.reduce((sum, rgb) => sum + rgb[index], 0) / rgbValues.length)
        .toString(16)
        .padStart(2, '0');
    return `#${average(0)}${average(1)}${average(2)}`;
}
function localDateFromIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match)
        return undefined;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() === Number(match[1]) &&
        date.getMonth() === Number(match[2]) - 1 &&
        date.getDate() === Number(match[3])
        ? date
        : undefined;
}
function allDayEventPlacementForDay(event, day) {
    if (!event.start.date || !event.end.date)
        return undefined;
    const start = localDateFromIsoDate(event.start.date);
    const end = localDateFromIsoDate(event.end.date);
    if (!start || !end || end <= start)
        return undefined;
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    if (dayStart < start || dayStart >= end)
        return undefined;
    return { summary: event.summary?.trim() || 'Untitled event' };
}
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
const DEFAULT_REFRESH_INTERVAL_MINUTES = 30;
const VISIBILITY_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
const CALENDAR_FETCH_RECOVERY_DELAY_MS = 60 * 1000;
const MAX_CALENDAR_FETCH_RECOVERY_ATTEMPTS = 2;
function refreshIntervalMs(intervalMinutes) {
    const minutes = intervalMinutes ?? DEFAULT_REFRESH_INTERVAL_MINUTES;
    if (!Number.isFinite(minutes) || minutes <= 0) {
        throw new Error('refresh_interval must be a positive finite number of minutes');
    }
    return minutes * 60 * 1000;
}
function shouldRefreshAfterVisibility(nowMs, lastUpdateMs) {
    return nowMs - lastUpdateMs > VISIBILITY_REFRESH_THRESHOLD_MS;
}
/** Limit short recovery retries so an unavailable HA API does not create a retry loop. */
function shouldRetryCalendarFetch(failedAttempts) {
    return failedAttempts < MAX_CALENDAR_FETCH_RECOVERY_ATTEMPTS;
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
function displayTitle(title) {
    const trimmed = title?.trim();
    return trimmed || undefined;
}
function eventPlacementForDay(event, day, visibleStartMinutes, visibleEndMinutes) {
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
    visibleStart.setMinutes(visibleStartMinutes, 0, 0);
    const visibleEnd = new Date(dayStart);
    visibleEnd.setMinutes(visibleEndMinutes, 0, 0);
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

const CALENDAR_VISUAL_LAYOUT = {
    /** Narrow but sufficient for localized hour labels; prevents a large blank left gutter. */
    axisWidthPx: 40,
    /** Keeps labels clear of the timeline border, matching the graph-card convention. */
    axisLabelGapPx: 10,
    /** Preserve the usual compact card inset on the label side. */
    paddingLeftPx: 12,
    /** Give the timeline the more generous graph-like trailing inset. */
    paddingRightPx: 32,
    /** HA's readable small-text scale (14 px at the default root size). */
    textSizeRem: 0.875};
/**
 * Keep the time labels within the axis for either 12- or 24-hour locales while
 * preserving the intended clear gap before the timeline border.
 */
function timeAxisWidthPx(maxLabelWidthPx) {
    return Math.max(CALENDAR_VISUAL_LAYOUT.axisWidthPx, Math.ceil(maxLabelWidthPx + CALENDAR_VISUAL_LAYOUT.axisLabelGapPx));
}

const GRID_INTERVALS = [15, 20, 30, 60, 120];
function parseTime(value) {
    if (value === undefined)
        return undefined;
    const match = /^(?:([01]\d|2[0-3]):([0-5]\d)|(24):00)$/.exec(value);
    if (!match)
        return undefined;
    return match[3] ? 24 * 60 : Number(match[1]) * 60 + Number(match[2]);
}
function formatTime(minutes) {
    const hours = Math.floor(minutes / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
function normalizeEditorConfig(config) {
    const { start_hour, end_hour, ...withoutLegacyHours } = config;
    return {
        ...withoutLegacyHours,
        ...(config.start_time === undefined && start_hour !== undefined
            ? { start_time: formatTime(start_hour * 60) }
            : {}),
        ...(config.end_time === undefined && end_hour !== undefined
            ? { end_time: formatTime(end_hour * 60) }
            : {}),
        calendars: (config.calendars ?? []).map((calendar) => ({ ...calendar })),
    };
}
function validateEditorConfig(config) {
    const errors = [];
    const calendars = config.calendars ?? [];
    if (calendars.length === 0)
        errors.push('Add at least one calendar source.');
    if (calendars.some((calendar) => !calendar.entity?.startsWith('calendar.'))) {
        errors.push('Every calendar source needs a calendar.* entity.');
    }
    if (config.days !== undefined && (!Number.isInteger(config.days) || config.days < 1 || config.days > 7)) {
        errors.push('Days displayed must be a whole number from 1 to 7.');
    }
    const startMinutes = parseTime(config.start_time);
    const endMinutes = parseTime(config.end_time);
    if ((config.start_time !== undefined && startMinutes === undefined) ||
        (config.end_time !== undefined && endMinutes === undefined)) {
        errors.push('Start time and end time must use the HH:mm format.');
    }
    else if (startMinutes !== undefined && endMinutes !== undefined && startMinutes >= endMinutes) {
        errors.push('Start time must be before end time.');
    }
    if (config.slot_minutes !== undefined && !GRID_INTERVALS.includes(config.slot_minutes)) {
        errors.push('Grid interval must be 15, 20, 30, 60, or 120 minutes.');
    }
    if (config.height !== undefined && config.height !== null && (!Number.isFinite(config.height) || config.height <= 0)) {
        errors.push('Fixed height must be a positive number of pixels.');
    }
    if (config.max_simultaneous_events !== undefined && (!Number.isInteger(config.max_simultaneous_events) || config.max_simultaneous_events < 1)) {
        errors.push('Maximum simultaneous events must be a positive whole number.');
    }
    return errors;
}
function editorWarnings(config) {
    const calendars = config.calendars ?? [];
    const labels = calendars.map((calendar) => calendar.label?.trim()).filter((label) => Boolean(label));
    const colors = calendars.map((calendar) => calendar.color?.toLowerCase()).filter((color) => Boolean(color));
    const warnings = [];
    for (const [values, property] of [[labels, 'label'], [colors, 'color']]) {
        const duplicate = values.find((value, index) => values.indexOf(value) !== index);
        if (duplicate)
            warnings.push(`Two or more calendar sources use the ${property} ${property === 'label' ? `“${duplicate}”` : duplicate}.`);
    }
    return warnings;
}

const CARD_TYPE = 'custom:multiday-calendar-card';
function escapeHtml$1(value) {
    return value.replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character] ?? character);
}
function numberValue(value) {
    if (value.trim() === '')
        return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}
class MultidayCalendarCardEditor extends HTMLElement {
    constructor() {
        super(...arguments);
        this._config = { type: CARD_TYPE, calendars: [] };
    }
    connectedCallback() {
        void this.loadEntityPicker();
    }
    async loadEntityPicker() {
        if (customElements.get('ha-entity-picker'))
            return;
        const entitiesCard = customElements.get('hui-entities-card');
        if (!entitiesCard?.getConfigElement)
            return;
        try {
            await entitiesCard.getConfigElement();
            this.render();
        }
        catch {
            // The fallback remains an empty picker until Home Assistant provides the element.
        }
    }
    setConfig(config) {
        this._config = normalizeEditorConfig({ ...config, type: CARD_TYPE });
        this.render();
    }
    set hass(hass) {
        this._hass = hass;
        this.assignHassToEntityPickers();
    }
    updateConfig(update, rerender = false) {
        this._config = normalizeEditorConfig({ ...this._config, ...update });
        this.updateValidation();
        if (validateEditorConfig(this._config).length === 0) {
            this.dispatchEvent(new CustomEvent('config-changed', {
                bubbles: true,
                composed: true,
                detail: { config: this._config },
            }));
        }
        if (rerender)
            this.render();
    }
    setCalendar(index, update) {
        const calendars = (this._config.calendars ?? []).map((calendar, row) => row === index ? { ...calendar, ...update } : calendar);
        this.updateConfig({ calendars });
    }
    assignHassToEntityPickers() {
        this.querySelectorAll('ha-entity-picker').forEach((picker) => {
            picker.hass = this._hass;
            picker.includeDomains = ['calendar'];
            picker.value = picker.getAttribute('value') ?? '';
        });
    }
    updateValidation() {
        const errors = validateEditorConfig(this._config);
        const warnings = editorWarnings(this._config);
        const validation = this.querySelector('.validation');
        if (!validation)
            return;
        validation.innerHTML = [
            ...errors.map((message) => `<div class="error">${escapeHtml$1(message)}</div>`),
            ...warnings.map((message) => `<div class="warning">${escapeHtml$1(message)}</div>`),
        ].join('');
    }
    render() {
        const config = this._config;
        const calendars = config.calendars ?? [];
        const fixedHeight = config.height !== undefined && config.height !== null;
        const startTime = config.start_time ?? '06:00';
        const endTime = config.end_time ?? '22:00';
        this.innerHTML = `
      <style>
        :host { display: block; }
        .section { border-top: 1px solid var(--divider-color); padding: 12px 0; }
        .section:first-child { border-top: 0; padding-top: 0; }
        h3 { margin: 0 0 10px; font-size: 1rem; }
        .field, .calendar-row { display: grid; gap: 6px; margin: 8px 0; }
        .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .calendar-row { grid-template-columns: minmax(0, 1fr) auto; align-items: end; column-gap: 12px; padding: 10px; border: 1px solid var(--divider-color); border-radius: 8px; }
        .calendar-details { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(160px, 0.4fr); gap: 12px; }
        .color-control { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 8px; align-items: center; }
        .color-control input[type="color"] { min-height: 38px; padding: 2px; cursor: pointer; }
        label { font-size: 0.875rem; color: var(--secondary-text-color); }
        input, select { box-sizing: border-box; width: 100%; min-height: 38px; padding: 7px; border: 1px solid var(--divider-color); border-radius: 4px; color: var(--primary-text-color); background: var(--card-background-color); font: inherit; }
        ha-entity-picker { display: block; min-width: 0; }
        button { min-height: 36px; padding: 6px 10px; border: 1px solid var(--primary-color); border-radius: 4px; color: var(--primary-color); background: transparent; font: inherit; cursor: pointer; }
        button.remove { border-color: var(--error-color); color: var(--error-color); }
        .toggle { display: flex; align-items: center; gap: 8px; color: var(--primary-text-color); }
        .toggle input { width: auto; min-height: auto; }
        .hint, .validation { margin: 8px 0 0; font-size: 0.875rem; color: var(--secondary-text-color); }
        .error { color: var(--error-color); margin: 4px 0; }
        .warning { color: var(--warning-color, #b26a00); margin: 4px 0; }
        @media (max-width: 600px) { .grid, .calendar-row, .calendar-details { grid-template-columns: 1fr; } .calendar-details { grid-column: auto; } }
      </style>
      <section class="section">
        <h3>Calendar sources</h3>
        <div class="calendar-list">${calendars.map((calendar, index) => `
          <div class="calendar-row" data-calendar-index="${index}">
            <div class="field"><label>Calendar entity</label><ha-entity-picker data-field="entity" value="${escapeHtml$1(calendar.entity ?? '')}"></ha-entity-picker></div>
            <button class="remove" data-action="remove-calendar" type="button" aria-label="Remove calendar source">Remove</button>
            <div class="calendar-details">
              <div class="field"><label>Display label (optional)</label><input data-field="label" value="${escapeHtml$1(calendar.label ?? '')}" placeholder="Calendar name"></div>
              <div class="field"><label>Event color</label><div class="color-control"><input data-action="pick-color" type="color" value="${/^#[0-9a-f]{6}$/i.test(calendar.color ?? '') ? calendar.color : '#4caf50'}" aria-label="Choose event color"><input data-field="color" value="${escapeHtml$1(calendar.color ?? '')}" placeholder="#4caf50" pattern="^#[0-9a-fA-F]{6}$"></div></div>
            </div>
          </div>`).join('')}</div>
        <button data-action="add-calendar" type="button">Add calendar</button>
        <div class="hint">Sources may intentionally share a label or color; the editor only warns when they do.</div>
      </section>
      <section class="section">
        <h3>View & schedule</h3>
        <div class="field"><label>Card title</label><input data-config="title" value="${escapeHtml$1(config.title ?? '')}" placeholder="Calendar"></div>
        <label class="toggle"><input type="checkbox" data-action="hide-title" ${config.title === undefined ? 'checked' : ''}> Hide card title</label>
        <div class="grid">
          <div class="field"><label>Days displayed</label><input data-config="days" type="number" min="1" max="7" step="1" value="${config.days ?? 2}"></div>
          <div class="field"><label>Grid interval</label><select data-config="slot_minutes">${GRID_INTERVALS.map((minutes) => `<option value="${minutes}" ${config.slot_minutes === minutes || (config.slot_minutes === undefined && minutes === 30) ? 'selected' : ''}>${minutes === 120 ? '2 hours' : `${minutes} minutes`}</option>`).join('')}</select></div>
          <div class="field"><label>Start time</label><select data-config="start_time">${parseTime(startTime) % 60 !== 0 ? `<option value="${startTime}" selected>${startTime} (custom)</option>` : ''}${Array.from({ length: 24 }, (_, hour) => `<option value="${String(hour).padStart(2, '0')}:00" ${startTime === formatTime(hour * 60) ? 'selected' : ''}>${String(hour).padStart(2, '0')}:00</option>`).join('')}</select></div>
          <div class="field"><label>End time</label><select data-config="end_time">${parseTime(endTime) % 60 !== 0 ? `<option value="${endTime}" selected>${endTime} (custom)</option>` : ''}${Array.from({ length: 24 }, (_, hour) => hour + 1).map((hour) => `<option value="${String(hour).padStart(2, '0')}:00" ${endTime === formatTime(hour * 60) ? 'selected' : ''}>${String(hour).padStart(2, '0')}:00</option>`).join('')}</select></div>
        </div>
        <label class="toggle"><input data-config="show_now_line" type="checkbox" ${config.show_now_line !== false ? 'checked' : ''}> Show current-time line</label>
        <div class="field"><label>Maximum simultaneous timed events</label><input data-config="max_simultaneous_events" type="number" min="1" step="1" value="${config.max_simultaneous_events ?? 3}"><div class="hint">At 1, only the first overlapping event is shown. At 2 or more, the final lane summarizes any excess as “+N more”.</div></div>
      </section>
      <section class="section">
        <h3>Layout & density</h3>
        <label class="toggle"><input type="checkbox" data-action="fixed-height" ${fixedHeight ? 'checked' : ''}> Use a fixed card height</label>
        <div class="field fixed-height-field" ${fixedHeight ? '' : 'hidden'}><label>Fixed height (pixels)</label><input data-config="height" type="number" min="1" step="1" value="${fixedHeight ? config.height : ''}"><div class="hint">A fixed height compresses the timeline; it does not hide events.</div></div>
      </section>
      <div class="validation" role="alert"></div>
    `;
        this.bindEvents();
        this.assignHassToEntityPickers();
        this.updateValidation();
    }
    bindEvents() {
        this.querySelector('[data-action="add-calendar"]')?.addEventListener('click', () => {
            this.updateConfig({ calendars: [...(this._config.calendars ?? []), { entity: '' }] }, true);
        });
        this.querySelectorAll('[data-action="remove-calendar"]').forEach((button) => button.addEventListener('click', () => {
            const index = Number(button.closest('[data-calendar-index]')?.dataset.calendarIndex);
            this.updateConfig({ calendars: (this._config.calendars ?? []).filter((_, row) => row !== index) }, true);
        }));
        this.querySelector('[data-action="hide-title"]')?.addEventListener('change', (event) => {
            const hidden = event.target.checked;
            this.updateConfig(hidden ? { title: undefined } : { title: '' }, true);
        });
        this.querySelector('[data-action="fixed-height"]')?.addEventListener('change', (event) => {
            const fixed = event.target.checked;
            this.updateConfig({ height: fixed ? 480 : null }, true);
        });
        this.querySelectorAll('[data-config]').forEach((field) => field.addEventListener('change', () => {
            const key = field.dataset.config;
            const value = field.type === 'checkbox' ? field.checked :
                field.type === 'number' || ['days', 'slot_minutes', 'max_simultaneous_events'].includes(key)
                    ? numberValue(field.value)
                    : field.value;
            this.updateConfig({ [key]: value });
        }));
        this.querySelectorAll('[data-calendar-index]').forEach((row) => {
            const index = Number(row.dataset.calendarIndex);
            row.querySelector('ha-entity-picker')?.addEventListener('value-changed', (event) => {
                this.setCalendar(index, { entity: event.detail.value ?? '' });
            });
            row.querySelectorAll('input[data-field]').forEach((field) => field.addEventListener('change', () => {
                this.setCalendar(index, { [field.dataset.field]: field.value.trim() || undefined });
            }));
            row.querySelector('[data-action="pick-color"]')?.addEventListener('input', (event) => {
                const color = event.target.value;
                const textField = row.querySelector('input[data-field="color"]');
                if (textField)
                    textField.value = color;
                this.setCalendar(index, { color });
            });
        });
    }
}
customElements.define('multiday-calendar-card-editor', MultidayCalendarCardEditor);

const DEFAULT_CONFIG = {
    days: 2,
    start_time: '06:00',
    end_time: '22:00',
    slot_minutes: 30,
    refresh_interval: 30,
    height: null,
    show_now_line: true,
    max_simultaneous_events: 3,
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
        this._failedFetchAttempts = 0;
        this._lastEventsUpdateMs = 0;
        this.handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' &&
                shouldRefreshAfterVisibility(Date.now(), this._lastEventsUpdateMs)) {
                void this.loadEvents(true);
            }
        };
    }
    static getConfigElement() {
        return document.createElement('multiday-calendar-card-editor');
    }
    static getStubConfig() {
        return {
            type: 'custom:multiday-calendar-card',
            calendars: [],
            days: 2,
            start_time: '06:00',
            end_time: '22:00',
            slot_minutes: 30,
            show_now_line: true,
            max_simultaneous_events: 3,
        };
    }
    setConfig(config) {
        if (!config?.type) {
            throw new Error('Card config requires a type');
        }
        const startTime = config.start_time ?? formatTime(Number(config.start_hour ?? 6) * 60);
        const endTime = config.end_time ?? formatTime(Number(config.end_hour ?? 22) * 60);
        const startMinutes = parseTime(startTime);
        const endMinutes = parseTime(endTime);
        if (startMinutes === undefined || endMinutes === undefined || startMinutes >= endMinutes) {
            throw new Error('start_time and end_time must use HH:mm values from 00:00 through 24:00, with start_time before end_time');
        }
        const days = Number(config.days ?? DEFAULT_CONFIG.days);
        if (!Number.isInteger(days) || days < 1 || days > 7) {
            throw new Error('days must be a whole number from 1 to 7');
        }
        const slotMinutes = Number(config.slot_minutes ?? DEFAULT_CONFIG.slot_minutes);
        if (!Number.isInteger(slotMinutes) || ![15, 20, 30, 60, 120].includes(slotMinutes)) {
            throw new Error('slot_minutes must be 15, 20, 30, 60, or 120');
        }
        const refreshInterval = Number(config.refresh_interval ?? DEFAULT_CONFIG.refresh_interval);
        refreshIntervalMs(refreshInterval);
        const maxSimultaneousEvents = Number(config.max_simultaneous_events ?? DEFAULT_CONFIG.max_simultaneous_events);
        if (!Number.isInteger(maxSimultaneousEvents) || maxSimultaneousEvents < 1) {
            throw new Error('max_simultaneous_events must be a positive whole number');
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
            start_time: startTime,
            end_time: endTime,
            slot_minutes: slotMinutes,
            refresh_interval: refreshInterval,
            max_simultaneous_events: maxSimultaneousEvents,
            height,
            calendars,
        };
        this._requestKey = undefined;
        this.cancelRecoveryRefresh();
        this._failedFetchAttempts = 0;
        this.render();
        void this.loadEvents();
        if (this.isConnected)
            this.startRefreshTimer();
    }
    set hass(hass) {
        this._hass = hass;
        this.render();
        void this.loadEvents(this._error !== undefined);
    }
    getCardSize() {
        return 8;
    }
    connectedCallback() {
        this.render();
        void this.loadEvents();
        this.startRefreshTimer();
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    disconnectedCallback() {
        if (this._refreshTimerId !== undefined) {
            clearTimeout(this._refreshTimerId);
            this._refreshTimerId = undefined;
        }
        this.cancelRecoveryRefresh();
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    startRefreshTimer() {
        if (!this._config)
            return;
        if (this._refreshTimerId !== undefined)
            clearTimeout(this._refreshTimerId);
        this._refreshTimerId = window.setTimeout(() => {
            void this.loadEvents(true);
            this.startRefreshTimer();
        }, refreshIntervalMs(this._config.refresh_interval));
    }
    cancelRecoveryRefresh() {
        if (this._recoveryTimerId !== undefined) {
            clearTimeout(this._recoveryTimerId);
            this._recoveryTimerId = undefined;
        }
    }
    scheduleRecoveryRefresh() {
        if (!shouldRetryCalendarFetch(this._failedFetchAttempts))
            return;
        this._failedFetchAttempts += 1;
        this.cancelRecoveryRefresh();
        this._recoveryTimerId = window.setTimeout(() => {
            this._recoveryTimerId = undefined;
            if (this.isConnected)
                void this.loadEvents(true);
        }, CALENDAR_FETCH_RECOVERY_DELAY_MS);
    }
    async loadEvents(force = false) {
        if (!this._config || !this._hass)
            return;
        const range = eventRangeForDays(new Date(), this._config.days);
        const key = JSON.stringify({
            calendars: this._config.calendars,
            start: range.start.toISOString(),
            end: range.end.toISOString(),
        });
        if (!force && key === this._requestKey)
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
            this._lastEventsUpdateMs = Date.now();
            this._failedFetchAttempts = 0;
            this.cancelRecoveryRefresh();
        }
        catch (error) {
            if (this._requestKey !== key)
                return;
            this._events = [];
            this._error = error instanceof Error ? error.message : 'Unable to load calendar events';
            this.scheduleRecoveryRefresh();
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
        const startMinutes = parseTime(config.start_time);
        const endMinutes = parseTime(config.end_time);
        const minutesVisible = endMinutes - startMinutes;
        const visibleHours = minutesVisible / 60;
        const geometry = timelineGeometry(visibleHours, config.slot_minutes);
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
        const dayHeaderHeight = calendarHeaderHeight(Math.max(0, ...days.map((day) => this._events.filter(({ event }) => allDayEventPlacementForDay(event, day) !== undefined).length)));
        const timeLabelMinutes = [
            startMinutes,
            ...Array.from({ length: 24 }, (_, hour) => hour * 60).filter((minutes) => minutes > startMinutes && minutes < endMinutes),
            endMinutes,
        ];
        const timeLabelValues = timeLabelMinutes.map((minutes) => {
            const time = new Date(range.start);
            time.setMinutes(minutes, 0, 0);
            return timeFormatter.format(time);
        });
        const gridLines = Array.from({ length: Math.floor((endMinutes - Math.ceil(startMinutes / config.slot_minutes) * config.slot_minutes) / config.slot_minutes) + 1 }, (_, index) => Math.ceil(startMinutes / config.slot_minutes) * config.slot_minutes + index * config.slot_minutes)
            .filter((minutes) => minutes > startMinutes && minutes < endMinutes)
            .map((minutes) => `<div class="grid-line" style="top: ${((minutes - startMinutes) / minutesVisible) * 100}%"></div>`)
            .join('');
        const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
        const context = document.createElement('canvas').getContext('2d');
        const labelFontSize = rootFontSize * CALENDAR_VISUAL_LAYOUT.textSizeRem;
        if (context)
            context.font = `${labelFontSize}px ${getComputedStyle(this).fontFamily}`;
        const measuredTimeAxisWidth = timeAxisWidthPx(Math.max(...timeLabelValues.map((label) => context?.measureText(label).width ?? 0)));
        const timeLabels = timeLabelValues.map((label, index) => {
            const top = `${((timeLabelMinutes[index] - startMinutes) / minutesVisible) * 100}%`;
            return `<div class="time-label" style="top: ${top}">${escapeHtml(label)}</div>`;
        }).join('');
        const dayColumns = days
            .map((day) => {
            const allDayPlacements = this._events
                .map(({ calendar, event }) => ({
                calendar,
                placement: allDayEventPlacementForDay(event, day),
            }))
                .filter((item) => item.placement !== undefined);
            const allDayEvents = allDayPlacements
                .map(({ calendar, placement }) => {
                const calendarName = calendar.label ?? calendar.entity;
                return `<div class="all-day-event" style="--event-color: ${safeColor(calendar.color)}" title="${escapeHtml(`${placement.summary} — ${calendarName}`)}">${escapeHtml(placement.summary)}</div>`;
            })
                .join('');
            const placements = this._events
                .map(({ calendar, event }) => ({
                calendar,
                placement: eventPlacementForDay(event, day, startMinutes, endMinutes),
            }))
                .filter((item) => item.placement !== undefined);
            const laneLayout = layoutTimedEventLanes(placements.map(({ calendar, placement }) => ({
                event: { calendar, placement },
                startMinutes: placement.startMinutes,
                durationMinutes: placement.durationMinutes,
            })), config.max_simultaneous_events);
            const eventStyle = (eventStartMinutes, durationMinutes, lane, laneCount) => {
                const top = ((eventStartMinutes - startMinutes) / minutesVisible) * 100;
                const height = (durationMinutes / minutesVisible) * 100;
                const laneWidth = 100 / laneCount;
                return `top: ${top}%; height: ${height}%; left: calc(${lane * laneWidth}% + 4px); width: calc(${laneWidth}% - 8px)`;
            };
            const events = laneLayout.events
                .map(({ event: { calendar, placement }, lane, laneCount }) => {
                const calendarName = calendar.label ?? calendar.entity;
                return `<div class="event" style="${eventStyle(placement.startMinutes, placement.durationMinutes, lane, laneCount)}; --event-color: ${safeColor(calendar.color)}" title="${escapeHtml(`${placement.summary} — ${calendarName}`)}">
              <div class="event-summary">${escapeHtml(placement.summary)}</div>
              <div class="event-calendar">${escapeHtml(calendarName)}</div>
            </div>`;
            })
                .join('');
            const overflowEvents = laneLayout.overflows
                .map(({ startMinutes, durationMinutes, lane, laneCount, hiddenEvents }) => {
                const hiddenCalendars = hiddenEvents.map(({ calendar }) => calendar.label ?? calendar.entity);
                const color = averageEventColors(hiddenEvents.map(({ calendar }) => calendar.color ?? '')) ?? 'var(--primary-color)';
                const count = hiddenEvents.length;
                return `<div class="event event-overflow" style="${eventStyle(startMinutes, durationMinutes, lane, laneCount)}; --event-color: ${color}" title="${escapeHtml(`${count} undisplayed event${count === 1 ? '' : 's'} — ${hiddenCalendars.join(', ')}`)}">
              <div class="event-summary">+${count} more</div>
            </div>`;
            })
                .join('');
            const isToday = sameLocalDay(day, now);
            const nowLine = config.show_now_line && isToday && now.getHours() * 60 + now.getMinutes() >= startMinutes && now.getHours() * 60 + now.getMinutes() < endMinutes
                ? `<div class="now-line" style="top: ${((now.getHours() * 60 + now.getMinutes() - startMinutes) / minutesVisible) * 100}%"></div>`
                : '';
            return `<section class="day-column">
          <header class="day-header${isToday ? ' today' : ''}" style="--day-header-height: ${dayHeaderHeight}px">
            <div class="day-name">${escapeHtml(dateFormatter.format(day))}</div>
            ${allDayEvents ? `<div class="all-day-events">${allDayEvents}</div>` : ''}
          </header>
          <div class="timeline" style="${fixedHeight ? '' : `height: ${timelineHeight}px;`} --slot-height: ${slotHeight}px; --slot-count: ${geometry.slotCount}">
            ${gridLines}${events}${overflowEvents}${nowLine}
          </div>
        </section>`;
        })
            .join('');
        const title = displayTitle(config.title);
        const accessibleTitle = title ?? 'Multi-day calendar';
        const hasTitle = title !== undefined;
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
      <ha-card class="${fixedHeight ? 'fixed-height' : ''}"${fixedHeight ? ` style="height: ${config.height}px"` : ''}${hasTitle ? ` header="${escapeHtml(title)}"` : ''}>
        <div class="wrapper ${fixedHeight ? 'fixed-height' : ''}${hasTitle ? '' : ' titleless'}">
          ${status}
          <div class="schedule ${fixedHeight ? 'fixed-height' : ''}" role="grid" aria-label="${escapeHtml(accessibleTitle)}">
            <div class="time-axis ${fixedHeight ? 'fixed-height' : ''}" style="--day-header-height: ${dayHeaderHeight}px;${fixedHeight ? '' : ` height: ${timelineHeight + dayHeaderHeight}px;`}">
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
      .wrapper { padding: ${CALENDAR_VISUAL_LAYOUT.paddingLeftPx}px ${CALENDAR_VISUAL_LAYOUT.paddingRightPx}px 12px ${CALENDAR_VISUAL_LAYOUT.paddingLeftPx}px; overflow-x: auto; }
      .wrapper.fixed-height { box-sizing: border-box; height: calc(100% - 56px); display: flex; flex-direction: column; }
      .wrapper.fixed-height.titleless { height: 100%; }
      .status { margin: 0 0 10px; color: var(--secondary-text-color); }
      .status.error { color: var(--error-color); }
      .schedule { display: grid; grid-template-columns: ${measuredTimeAxisWidth}px minmax(0, 1fr); min-width: 460px; }
      .schedule.fixed-height { flex: 1; min-height: 0; }
      .time-axis { position: relative; color: var(--primary-text-color); font-size: ${CALENDAR_VISUAL_LAYOUT.textSizeRem}rem; }
      .time-axis.fixed-height { height: 100%; }
      .time-axis-spacer { height: var(--day-header-height); border-bottom: ${'none'}; }
      .time-labels { position: relative; height: calc(100% - var(--day-header-height)); }
      .time-label { position: absolute; right: ${CALENDAR_VISUAL_LAYOUT.axisLabelGapPx}px; transform: translateY(-50%); white-space: nowrap; }
      .time-label:last-child { transform: translateY(-100%); }
      .day-columns { display: grid; grid-template-columns: repeat(${config.days}, minmax(140px, 1fr)); border-left: 1px solid var(--divider-color); }
      .day-columns.fixed-height { height: 100%; }
      .day-column { min-width: 0; border-right: 1px solid var(--divider-color); }
      .day-columns.fixed-height .day-column { display: flex; flex-direction: column; }
      .day-header { height: var(--day-header-height); box-sizing: border-box; display: flex; flex-direction: column; border-bottom: 1px solid var(--divider-color); font-weight: 600; font-size: 0.875rem; flex: 0 0 auto; }
      .day-name { height: 37px; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
      .day-header.today .day-name { color: var(--primary-color); }
      .all-day-events { display: grid; grid-auto-rows: 18px; gap: 4px; padding: 0 4px 4px; min-height: 0; }
      .all-day-event { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; box-sizing: border-box; border-left: 4px solid var(--event-color); border-radius: 4px; padding: 1px 5px; background: color-mix(in srgb, var(--event-color) 25%, var(--card-background-color)); color: var(--primary-text-color); font-size: ${CALENDAR_VISUAL_LAYOUT.textSizeRem}rem; line-height: 16px; }
      .timeline { position: relative; }
      .day-columns.fixed-height .timeline { flex: 1; min-height: 0; }
      .grid-line { position: absolute; left: 0; right: 0; border-top: 1px solid var(--divider-color); z-index: 0; }
      .event { position: absolute; min-height: 18px; box-sizing: border-box; overflow: hidden; border-left: 4px solid var(--event-color); border-radius: 4px; padding: 3px 5px; background: color-mix(in srgb, var(--event-color) 25%, var(--card-background-color)); color: var(--primary-text-color); font-size: ${CALENDAR_VISUAL_LAYOUT.textSizeRem}rem; line-height: 1.2; z-index: 1; }
      .event-overflow { border-left-style: dashed; font-style: italic; }
      .event-summary { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .event-calendar { color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .now-line { position: absolute; left: 0; right: 0; height: 2px; background: var(--error-color); z-index: 2; pointer-events: none; }
      @media (max-width: 600px) { .wrapper { padding: 8px; } .schedule { min-width: 380px; } .time-label { right: ${CALENDAR_VISUAL_LAYOUT.axisLabelGapPx}px; font-size: 0.75rem; } .event-calendar { display: none; } }
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
