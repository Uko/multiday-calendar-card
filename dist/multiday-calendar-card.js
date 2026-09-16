const CALENDAR_DAY_NAME_HEIGHT_PX = 38;
const ALL_DAY_EVENT_ROW_HEIGHT_PX = 22;
const DAY_NAMES = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
function dayName(date) {
    return DAY_NAMES[(date.getDay() + 6) % 7];
}
function normalizeSkipDays(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || !value.every((day) => DAY_NAMES.includes(day))) {
        throw new Error('skip_days must be a list containing only mo, tu, we, th, fr, sa, or su');
    }
    const skipDays = Array.from(new Set(value));
    if (skipDays.length === DAY_NAMES.length) {
        throw new Error('skip_days cannot include every day of the week');
    }
    return skipDays;
}
/** Return exactly `days` dates, omitting any configured local weekday names. */
function visibleDays(now, days, skipDays = []) {
    const skipped = new Set(skipDays);
    const cursor = new Date(now);
    cursor.setHours(0, 0, 0, 0);
    const visible = [];
    while (visible.length < days) {
        if (!skipped.has(dayName(cursor)))
            visible.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return visible;
}
/** Return exactly `days` displayed local dates immediately before an anchor date. */
function visibleDaysBefore(anchor, days, skipDays = []) {
    const skipped = new Set(skipDays);
    const cursor = new Date(anchor);
    cursor.setHours(0, 0, 0, 0);
    const visible = [];
    while (visible.length < days) {
        cursor.setDate(cursor.getDate() - 1);
        if (!skipped.has(dayName(cursor)))
            visible.push(new Date(cursor));
    }
    return visible.reverse();
}
/** Use local calendar dates so daylight-saving transitions do not affect gap detection. */
function hasSkippedDaysBetween(left, right) {
    const localCalendarDay = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return localCalendarDay(right) - localCalendarDay(left) > 24 * 60 * 60 * 1000;
}
/** A first displayed date after today means skipped dates precede the visible window. */
function hasSkippedDaysBeforeFirstVisibleDay(today, firstVisibleDay) {
    return hasSkippedDaysBetween(today, firstVisibleDay);
}
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
function eventRangeForDays(now, days, skipDays = []) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const displayedDays = visibleDays(start, days, skipDays);
    const lastDisplayedDay = displayedDays[displayedDays.length - 1];
    const end = new Date(lastDisplayedDay);
    end.setDate(end.getDate() + 1);
    return { start, end };
}
/** Resolve a local calendar day from an input_datetime-style entity state. */
function startDayForEntityState(state, fallback) {
    const fallbackDay = new Date(fallback);
    fallbackDay.setHours(0, 0, 0, 0);
    if (typeof state !== 'string')
        return fallbackDay;
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.exec(state);
    if (!match)
        return fallbackDay;
    const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return day.getFullYear() === Number(match[1]) &&
        day.getMonth() === Number(match[2]) - 1 &&
        day.getDate() === Number(match[3])
        ? day
        : fallbackDay;
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
function timelineGeometry(visibleHours, slotMinutes, pixelsPerHour = DEFAULT_PIXELS_PER_HOUR, fixedTimelineHeightPx) {
    const fixedHeight = fixedTimelineHeightPx !== undefined;
    const timelineHeightPx = fixedHeight
        ? fixedTimelineHeightPx
        : visibleHours * pixelsPerHour;
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
/**
 * A fixed-height card must own its title in the flex body so that it is part of
 * the measured height. A native ha-card header is outside that body.
 */
function cardTitlePlacement(title, fixedHeight) {
    const display = displayTitle(title);
    return fixedHeight
        ? { cardHeader: undefined, bodyTitle: display }
        : { cardHeader: display, bodyTitle: undefined };
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

const DEFAULT_TAP_ACTION = { action: 'none' };
function validateTapAction(value) {
    if (value === undefined)
        return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return 'tap_action must be an action object.';
    }
    const action = value.action;
    if (action !== 'none' && action !== 'more-info') {
        return 'tap_action.action must be "none" or "more-info".';
    }
    return undefined;
}
function normalizeTapAction(value) {
    const error = validateTapAction(value);
    if (error)
        throw new Error(error);
    return value === undefined ? { ...DEFAULT_TAP_ACTION } : { action: value.action };
}

const LOCATION_MAP_PROVIDERS = ['google_maps', 'osm_nominatim'];
const NOMINATIM_SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
function eventDetailTitle(summary) {
    return summary?.trim() || 'Untitled event';
}
function nominatimSearchUrl(location, endpoint = NOMINATIM_SEARCH_ENDPOINT) {
    const url = new URL(endpoint);
    if (url.pathname === '/' || url.pathname === '')
        url.pathname = '/search';
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('q', location);
    return url.href;
}
function googleMapsEmbedUrl(location) {
    const url = new URL('https://www.google.com/maps');
    url.searchParams.set('q', location);
    url.searchParams.set('output', 'embed');
    return url.href;
}
function finiteCoordinate(value, minimum, maximum) {
    const coordinate = typeof value === 'string' ? Number(value) : undefined;
    return coordinate !== undefined && Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum
        ? coordinate
        : undefined;
}
function parseBoundingBox(value) {
    if (!Array.isArray(value) || value.length !== 4)
        return undefined;
    const south = finiteCoordinate(value[0], -90, 90);
    const north = finiteCoordinate(value[1], -90, 90);
    const west = finiteCoordinate(value[2], -180, 180);
    const east = finiteCoordinate(value[3], -180, 180);
    return south === undefined || north === undefined || west === undefined || east === undefined || south > north || west > east
        ? undefined
        : [south, north, west, east];
}
async function geocodeLocation(location, endpoint, fetcher = fetch, signal) {
    const response = await fetcher(nominatimSearchUrl(location, endpoint), { signal });
    if (!response.ok)
        return undefined;
    const results = await response.json();
    if (!Array.isArray(results) || !results[0] || typeof results[0] !== 'object')
        return undefined;
    const result = results[0];
    const latitude = finiteCoordinate(result.lat, -90, 90);
    const longitude = finiteCoordinate(result.lon, -180, 180);
    if (latitude === undefined || longitude === undefined)
        return undefined;
    return { latitude, longitude, boundingBox: parseBoundingBox(result.boundingbox) };
}
function openStreetMapEmbedUrl(location) {
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
    return {
        ...config,
        calendars: (config.calendars ?? []).map((calendar) => ({ ...calendar })),
    };
}
function isAbsoluteHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    }
    catch {
        return false;
    }
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
    if (config.start_day_entity !== undefined && (typeof config.start_day_entity !== 'string' || config.start_day_entity.trim() === '')) {
        errors.push('Start day entity must be a non-empty entity ID.');
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
    if (config.skip_days !== undefined) {
        if (!Array.isArray(config.skip_days) || !config.skip_days.every((day) => DAY_NAMES.includes(day))) {
            errors.push('Skip days must be a list containing only mo, tu, we, th, fr, sa, or su.');
        }
        else if (new Set(config.skip_days).size === DAY_NAMES.length) {
            errors.push('Skip days cannot include every day of the week.');
        }
    }
    if (config.height !== undefined && config.height !== null && (!Number.isFinite(config.height) || config.height <= 0)) {
        errors.push('Fixed height must be a positive number of pixels.');
    }
    if (config.look_around !== undefined && typeof config.look_around !== 'boolean') {
        errors.push('Look around must be true or false.');
    }
    if ((config.height === undefined || config.height === null) && config.hour_height !== undefined &&
        (!Number.isFinite(config.hour_height) || config.hour_height <= 0)) {
        errors.push('Hour height must be a positive number of pixels.');
    }
    if (config.max_simultaneous_events !== undefined && (!Number.isInteger(config.max_simultaneous_events) || config.max_simultaneous_events < 1)) {
        errors.push('Maximum simultaneous events must be a positive whole number.');
    }
    const tapActionError = validateTapAction(config.tap_action);
    if (tapActionError)
        errors.push(tapActionError);
    if (config.show_location_map !== undefined && typeof config.show_location_map !== 'boolean') {
        errors.push('Show location map must be true or false.');
    }
    if (config.location_map_provider !== undefined && !LOCATION_MAP_PROVIDERS.includes(config.location_map_provider)) {
        errors.push('Map provider must be Google Maps or OpenStreetMap + Nominatim.');
    }
    if (config.custom_nominatim_url !== undefined &&
        (typeof config.custom_nominatim_url !== 'string' || !isAbsoluteHttpUrl(config.custom_nominatim_url))) {
        errors.push('Custom Nominatim URL must be an absolute HTTP(S) URL.');
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

const LOOK_AROUND_RESET_DELAY_MS = 30_000;
/** Number of rendered dates on each side of the active date window. */
const LOOK_AROUND_BUFFER_DAYS = 90;
/** Rebuild the virtual date window before the native scroll position reaches an edge. */
const LOOK_AROUND_RECENTER_MARGIN_DAYS = 12;
function shouldRecenterLookAround(firstVisibleIndex, bufferDays = LOOK_AROUND_BUFFER_DAYS, marginDays = LOOK_AROUND_RECENTER_MARGIN_DAYS) {
    return firstVisibleIndex < marginDays || firstVisibleIndex > bufferDays * 2 - marginDays;
}

const NOMINATIM_LOOKUP_INTERVAL_MS = 1_000;
const geocodeCache = new Map();
let lastNominatimLookupMs = 0;
function escapeHtml$2(value) {
    return value.replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character] ?? character);
}
function safeCalendarColor(value) {
    return /^#[0-9a-f]{6}$/i.test(value) ? value : 'var(--primary-color)';
}
function localDate(value) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T00:00:00`)
        : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}
function eventDateRange(event, locale) {
    const startValue = event.start.dateTime ?? event.start.date;
    const endValue = event.end.dateTime ?? event.end.date;
    if (!startValue || !endValue)
        return 'Date unavailable';
    const start = localDate(startValue);
    const end = localDate(endValue);
    if (!start || !end)
        return 'Date unavailable';
    const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
    const dateTimeFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    const allDay = Boolean(event.start.date && event.end.date);
    if (allDay)
        end.setDate(end.getDate() - 1);
    if (start.toDateString() === end.toDateString()) {
        if (allDay)
            return dateFormatter.format(start);
        const timeFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
        return `${timeFormatter.format(start)} – ${new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(end)}`;
    }
    const formatter = allDay ? dateFormatter : dateTimeFormatter;
    return `${formatter.format(start)} – ${formatter.format(end)}`;
}
function safeUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
    }
    catch {
        return undefined;
    }
}
class MultidayCalendarEventDialog extends HTMLElement {
    constructor() {
        super(...arguments);
        this.onClosed = () => {
            this.closeDialog();
            this.dispatchEvent(new CustomEvent('dialog-closed', {
                bubbles: true,
                composed: true,
                detail: { dialog: this.localName },
            }));
        };
    }
    showDialog(params) {
        this._geocodeController?.abort();
        this._params = params;
        this.render();
    }
    closeDialog() {
        this._geocodeController?.abort();
        this._geocodeController = undefined;
        this._params = undefined;
        this.innerHTML = '';
        return true;
    }
    async renderLocationMap(location, title, provider, customNominatimUrl) {
        const target = this.querySelector('[data-map-location]');
        if (!target)
            return;
        if (provider === 'google_maps') {
            const mapUrl = googleMapsEmbedUrl(location);
            target.hidden = false;
            target.innerHTML = `<iframe title="Map for ${escapeHtml$2(title)}" src="${escapeHtml$2(mapUrl)}" loading="lazy"></iframe>`;
            return;
        }
        const cacheKey = `${customNominatimUrl ?? ''}\u0000${location}`;
        const cached = geocodeCache.get(cacheKey);
        let coordinates = cached;
        if (!geocodeCache.has(cacheKey)) {
            if (Date.now() - lastNominatimLookupMs < NOMINATIM_LOOKUP_INTERVAL_MS) {
                target.remove();
                return;
            }
            const controller = new AbortController();
            this._geocodeController = controller;
            try {
                lastNominatimLookupMs = Date.now();
                coordinates = await geocodeLocation(location, customNominatimUrl, fetch, controller.signal);
                geocodeCache.set(cacheKey, coordinates);
            }
            catch (error) {
                if (error.name === 'AbortError')
                    return;
                geocodeCache.set(cacheKey, undefined);
            }
            finally {
                if (this._geocodeController === controller)
                    this._geocodeController = undefined;
            }
        }
        if (target !== this.querySelector('[data-map-location]') || !coordinates) {
            target.remove();
            return;
        }
        const mapUrl = openStreetMapEmbedUrl(coordinates);
        const themeClass = this._params?.isDarkTheme ? 'dark-map' : 'light-map';
        target.hidden = false;
        target.innerHTML = `<iframe class="${themeClass}" title="Map for ${escapeHtml$2(title)}" src="${escapeHtml$2(mapUrl)}" loading="lazy"></iframe><p class="attribution"><a href="${escapeHtml$2(mapUrl)}" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p>`;
    }
    render() {
        if (!this._params)
            return;
        const { calendarName, calendarColor, showLocationMap, locationMapProvider, customNominatimUrl, event } = this._params;
        const locale = this.hass?.locale?.language ?? navigator.language ?? 'en';
        const title = eventDetailTitle(event.summary);
        const location = event.location?.trim();
        const url = event.url ? safeUrl(event.url) : undefined;
        this.innerHTML = `
      <ha-dialog open header-title="${escapeHtml$2(title)}">
        <div class="details" style="--calendar-color: ${safeCalendarColor(calendarColor)}">
          <dl>
            <div><dt>When</dt><dd>${escapeHtml$2(eventDateRange(event, locale))}</dd></div>
            <div><dt>Calendar</dt><dd>${escapeHtml$2(calendarName)}</dd></div>
            ${location ? `<div><dt>Location</dt><dd>${escapeHtml$2(location)}</dd></div>` : ''}
          </dl>
          ${location && showLocationMap && locationMapProvider ? '<section class="map" data-map-location hidden></section>' : ''}
          ${event.description?.trim() ? `<section><h3>Description</h3><p>${escapeHtml$2(event.description.trim())}</p></section>` : ''}
          ${url ? `<p><a href="${escapeHtml$2(url)}" target="_blank" rel="noopener noreferrer">Open event link</a></p>` : ''}
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
        if (location && showLocationMap && locationMapProvider) {
            void this.renderLocationMap(location, title, locationMapProvider, customNominatimUrl);
        }
    }
}
customElements.define('multiday-calendar-event-dialog', MultidayCalendarEventDialog);

const CARD_TYPE = 'custom:multiday-calendar-card';
function interactionSchema(showMoreInfo, showLocationMap, provider) {
    const schema = [
        {
            name: 'interactions',
            type: 'expandable',
            title: 'Interactions',
            icon: 'mdi:gesture-tap',
            flatten: true,
            expanded: true,
            schema: [
                {
                    name: 'tap_action',
                    selector: {
                        ui_action: {
                            actions: ['more-info', 'none'],
                            default_action: 'none',
                        },
                    },
                },
                ...(showMoreInfo ? [{ name: '', type: 'divider' }, { name: 'show_location_map', selector: { boolean: {} } }] : []),
                ...(showMoreInfo && showLocationMap ? [{
                        name: 'location_map_provider',
                        selector: {
                            select: {
                                options: [
                                    { value: 'google_maps', label: 'Google Maps' },
                                    { value: 'osm_nominatim', label: 'OpenStreetMap + Nominatim' },
                                ],
                            },
                        },
                    }] : []),
                ...(showMoreInfo && showLocationMap && provider === 'osm_nominatim' ? [{
                        name: 'custom_nominatim_url',
                        selector: { text: { type: 'url' } },
                    }] : []),
            ],
        },
    ];
    return schema;
}
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
        this.renderInteractionEditor();
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
        this.querySelectorAll('.calendar-row ha-entity-picker').forEach((picker) => {
            picker.hass = this._hass;
            picker.includeDomains = ['calendar'];
            picker.value = picker.getAttribute('value') ?? '';
        });
        const startPicker = this.querySelector('[data-config="start_day_entity"]');
        if (startPicker) {
            startPicker.hass = this._hass;
            startPicker.includeDomains = ['input_datetime'];
            startPicker.value = startPicker.getAttribute('value') ?? '';
        }
    }
    renderInteractionEditor() {
        const target = this.querySelector('[data-interaction-editor]');
        if (!target)
            return;
        const editor = document.createElement('ha-form');
        editor.hass = this._hass;
        editor.data = {
            tap_action: this._config.tap_action,
            show_location_map: this._config.show_location_map === true,
            location_map_provider: this._config.location_map_provider,
            custom_nominatim_url: this._config.custom_nominatim_url,
        };
        editor.schema = interactionSchema(this._config.tap_action?.action === 'more-info', this._config.show_location_map === true, this._config.location_map_provider);
        editor.computeLabel = (schema) => {
            if (schema.name === 'tap_action')
                return 'Tap behaviour (optional)';
            if (schema.name === 'show_location_map') {
                return 'Resolve event location with an external geocoding provider (your location data will be sent to an external service to convert the event address into coordinates)';
            }
            if (schema.name === 'location_map_provider')
                return 'Map provider';
            if (schema.name === 'custom_nominatim_url')
                return 'Custom Nominatim URL (optional)';
            return schema.name;
        };
        editor.addEventListener('value-changed', (event) => {
            const value = event.detail.value;
            this.updateConfig({
                tap_action: value.tap_action ?? this._config.tap_action,
                show_location_map: value.show_location_map === true,
                location_map_provider: value.location_map_provider ?? this._config.location_map_provider,
                custom_nominatim_url: value.custom_nominatim_url?.trim() || undefined,
            }, true);
        });
        target.replaceChildren(editor);
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
        .calendar-row { grid-template-columns: minmax(0, 1fr) 56px; align-items: stretch; column-gap: 16px; padding: 10px; border: 1px solid var(--divider-color); border-radius: 8px; }
        .remove-field { display: grid; grid-template-rows: auto 56px; gap: 6px; align-self: start; margin: 8px 0; }
        .remove-label { min-height: 1.2em; font-size: 0.875rem; line-height: normal; }
        .calendar-details { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(200px, 0.4fr); column-gap: 32px; }
        .color-control { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 12px; align-items: center; }
        .color-control input[type="color"] { min-height: 38px; padding: 2px; cursor: pointer; }
        label { font-size: 0.875rem; color: var(--secondary-text-color); }
        input, select { box-sizing: border-box; width: 100%; min-height: 38px; padding: 7px; border: 1px solid var(--divider-color); border-radius: 4px; color: var(--primary-text-color); background: var(--card-background-color); font: inherit; }
        ha-entity-picker { display: block; min-width: 0; }
        button { min-height: 36px; padding: 6px 10px; border: 1px solid var(--primary-color); border-radius: 4px; color: var(--primary-color); background: transparent; font: inherit; cursor: pointer; }
        button.remove { box-sizing: border-box; width: 56px; height: 56px; min-height: 56px; padding: 0; border-color: var(--error-color); color: var(--error-color); display: grid; place-items: center; }
        button.remove svg { width: 24px; height: 24px; fill: currentColor; }
        .toggle { display: flex; align-items: center; gap: 8px; color: var(--primary-text-color); }
        .toggle input { width: auto; min-height: auto; }
        .day-toggle-group { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
        .day-toggle { min-height: 38px; padding: 6px; border-color: var(--divider-color); color: var(--primary-text-color); }
        .day-toggle[aria-pressed="true"] { border-color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 18%, var(--card-background-color)); color: var(--primary-color); font-weight: 600; }
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
            <div class="remove-field"><span class="remove-label" aria-hidden="true">&nbsp;</span><button class="remove" data-action="remove-calendar" type="button" aria-label="Remove calendar source" title="Remove calendar source"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v1H4v2h1v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9m0 5h2v11H9V8m4 0h2v11h-2V8Z"/></svg></button></div>
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
        <label class="toggle"><input data-config="look_around" type="checkbox" ${config.look_around === true ? 'checked' : ''}> Enable horizontal look-around</label>
        <div class="hint">Scroll horizontally with a trackpad, touchscreen, or horizontal mouse wheel to preview the blank grid before or after the configured start date. The view returns to the start date after 30 seconds; no additional calendar data is loaded in this prototype.</div>
        <div class="field"><label>Skip days</label><div class="day-toggle-group" role="group" aria-label="Days to skip">${DAY_NAMES.map((day) => `<button class="day-toggle" data-action="toggle-skip-day" data-day-name="${day}" type="button" aria-pressed="${config.skip_days?.includes(day) === true}">${day}</button>`).join('')}</div><div class="hint">Selected days are omitted. Use two-letter names in YAML, for example <code>skip_days: [sa, su]</code>.</div></div>
        <div class="field"><label>Maximum simultaneous timed events</label><input data-config="max_simultaneous_events" type="number" min="1" step="1" value="${config.max_simultaneous_events ?? 3}"><div class="hint">At 1, only the first overlapping event is shown. At 2 or more, the final lane summarizes any excess as “+N more”.</div></div>
      </section>
      <div data-interaction-editor></div>
      <section class="section">
        <h3>Layout & density</h3>
        <label class="toggle"><input type="checkbox" data-action="fixed-height" ${fixedHeight ? 'checked' : ''}> Use a fixed card height</label>
        <div class="field"><label>Hour height (pixels)</label><input data-config="hour_height" type="number" min="1" step="1" value="${config.hour_height ?? 56}" ${fixedHeight ? 'disabled' : ''}><div class="hint">Timeline height per visible hour. Defaults to 56 pixels when omitted.</div></div>
        <div class="field fixed-height-field"><label>Fixed height (pixels)</label><input data-config="height" type="number" min="1" step="1" value="${fixedHeight ? config.height : ''}" ${fixedHeight ? '' : 'disabled'}><div class="hint">A fixed height compresses the timeline and overrides hour height; it does not hide events.</div></div>
      </section>
      <section class="section">
        <h3>Advanced</h3>
        <div class="field"><label>Start day entity (optional)</label><ha-entity-picker data-config="start_day_entity" value="${escapeHtml$1(config.start_day_entity ?? '')}"></ha-entity-picker><div class="hint">Use an input_datetime with a date. When unset, the calendar starts today.</div></div>
      </section>
      <div class="validation" role="alert"></div>
    `;
        this.bindEvents();
        this.assignHassToEntityPickers();
        this.renderInteractionEditor();
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
        this.querySelectorAll('[data-action="toggle-skip-day"]').forEach((button) => button.addEventListener('click', () => {
            const day = button.dataset.dayName;
            const skipDays = this._config.skip_days ?? [];
            this.updateConfig({
                skip_days: skipDays.includes(day)
                    ? skipDays.filter((value) => value !== day)
                    : [...skipDays, day],
            }, true);
        }));
        this.querySelectorAll('[data-config]').forEach((field) => field.addEventListener('change', () => {
            const key = field.dataset.config;
            const value = field.type === 'checkbox' ? field.checked :
                field.type === 'number' || ['days', 'slot_minutes', 'max_simultaneous_events'].includes(key)
                    ? numberValue(field.value)
                    : field.value;
            this.updateConfig({ [key]: value });
        }));
        this.querySelector('[data-config="start_day_entity"]')?.addEventListener('value-changed', (event) => {
            this.updateConfig({ start_day_entity: event.detail.value?.trim() || undefined });
        });
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
    hour_height: 56,
    look_around: false,
    show_now_line: true,
    skip_days: [],
    max_simultaneous_events: 3,
    tap_action: { action: 'none' },
    show_location_map: false,
    location_map_provider: undefined,
    custom_nominatim_url: undefined,
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
function locationMapProvider(value) {
    return typeof value === 'string' && LOCATION_MAP_PROVIDERS.includes(value)
        ? value
        : undefined;
}
function customNominatimUrl(value) {
    if (typeof value !== 'string')
        return undefined;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
    }
    catch {
        return undefined;
    }
}
function sameLocalDay(left, right) {
    return (left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate());
}
function localDateKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
function nowLineTopPercent(day, now, startMinutes, endMinutes) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (!sameLocalDay(day, now) || nowMinutes < startMinutes || nowMinutes >= endMinutes) {
        return undefined;
    }
    return ((nowMinutes - startMinutes) / (endMinutes - startMinutes)) * 100;
}
class MultiDayCalendarCard extends HTMLElement {
    constructor() {
        super(...arguments);
        this._events = [];
        this._loading = false;
        this._failedFetchAttempts = 0;
        this._lastEventsUpdateMs = 0;
        this.handleConnectionReady = () => {
            if (this.isConnected) {
                this.onNewStartDate(this.resolveStartDay());
                void this.loadEvents(true);
            }
        };
        this.handleVisibilityChange = () => {
            if (document.visibilityState !== 'visible')
                return;
            this.updateNowLine();
            const startDayChanged = this.onNewStartDate(this.resolveStartDay());
            if (startDayChanged || shouldRefreshAfterVisibility(Date.now(), this._lastEventsUpdateMs)) {
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
        const startTime = config.start_time ?? DEFAULT_CONFIG.start_time;
        const endTime = config.end_time ?? DEFAULT_CONFIG.end_time;
        const startMinutes = parseTime(startTime);
        const endMinutes = parseTime(endTime);
        if (startMinutes === undefined || endMinutes === undefined || startMinutes >= endMinutes) {
            throw new Error('start_time and end_time must use HH:mm values from 00:00 through 24:00, with start_time before end_time');
        }
        const days = Number(config.days ?? DEFAULT_CONFIG.days);
        if (!Number.isInteger(days) || days < 1 || days > 7) {
            throw new Error('days must be a whole number from 1 to 7');
        }
        const skipDays = normalizeSkipDays(config.skip_days);
        if (config.start_day_entity !== undefined && (typeof config.start_day_entity !== 'string' || config.start_day_entity.trim() === '')) {
            throw new Error('start_day_entity must be a non-empty Home Assistant entity ID when provided');
        }
        const startDayEntity = config.start_day_entity?.trim() || undefined;
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
        const hourHeight = height === null
            ? Number(config.hour_height ?? DEFAULT_CONFIG.hour_height)
            : DEFAULT_CONFIG.hour_height;
        if (height === null && (!Number.isFinite(hourHeight) || hourHeight <= 0)) {
            throw new Error('hour_height must be a positive number of pixels when height is omitted');
        }
        const calendars = config.calendars ?? [];
        if (!calendars.every((calendar) => calendar.entity.startsWith('calendar.'))) {
            throw new Error('Every calendars entry requires a calendar.* entity');
        }
        this._config = {
            ...DEFAULT_CONFIG,
            ...config,
            days,
            skip_days: skipDays,
            start_day_entity: startDayEntity,
            start_time: startTime,
            end_time: endTime,
            slot_minutes: slotMinutes,
            refresh_interval: refreshInterval,
            max_simultaneous_events: maxSimultaneousEvents,
            height,
            hour_height: hourHeight,
            look_around: config.look_around === true,
            calendars,
            tap_action: normalizeTapAction(config.tap_action),
            show_location_map: config.show_location_map === true,
            location_map_provider: locationMapProvider(config.location_map_provider),
            custom_nominatim_url: customNominatimUrl(config.custom_nominatim_url),
        };
        this._requestKey = undefined;
        this._activeStartDay = undefined;
        this.onNewStartDate(this.resolveStartDay());
        this.cancelRecoveryRefresh();
        this._failedFetchAttempts = 0;
        this.cancelLookAroundReset();
        this._lookAroundAnchorDay = undefined;
        this.render();
        void this.loadEvents();
        if (this.isConnected) {
            this.startRefreshTimer();
            this.startClockTimer();
            this.startDayRolloverTimer();
        }
    }
    set hass(hass) {
        const receivedInitialHass = this._hass === undefined;
        this._hass = hass;
        this.watchConnection(hass.connection);
        const startDayChanged = this.onNewStartDate(this.resolveStartDay());
        if (receivedInitialHass)
            void this.loadEvents(this._error !== undefined);
        else if (this._config?.start_day_entity && startDayChanged)
            void this.loadEvents();
    }
    getCardSize() {
        return 8;
    }
    connectedCallback() {
        this.onNewStartDate(this.resolveStartDay());
        this.render();
        this.watchConnection(this._hass?.connection);
        void this.loadEvents();
        this.startRefreshTimer();
        this.startClockTimer();
        this.startDayRolloverTimer();
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    disconnectedCallback() {
        if (this._refreshTimerId !== undefined) {
            clearTimeout(this._refreshTimerId);
            this._refreshTimerId = undefined;
        }
        if (this._clockTimerId !== undefined) {
            clearTimeout(this._clockTimerId);
            this._clockTimerId = undefined;
        }
        if (this._dayRolloverTimerId !== undefined) {
            clearTimeout(this._dayRolloverTimerId);
            this._dayRolloverTimerId = undefined;
        }
        this.cancelRecoveryRefresh();
        this.cancelLookAroundReset();
        this.watchConnection();
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    watchConnection(connection) {
        if (connection === this._connection)
            return;
        this._connection?.removeEventListener('ready', this.handleConnectionReady);
        this._connection = connection;
        this._connection?.addEventListener('ready', this.handleConnectionReady);
    }
    startClockTimer() {
        if (this._clockTimerId !== undefined)
            clearTimeout(this._clockTimerId);
        this.updateNowLine();
        const now = new Date();
        const delay = 60_000 - now.getSeconds() * 1_000 - now.getMilliseconds();
        this._clockTimerId = window.setTimeout(() => {
            this._clockTimerId = undefined;
            if (this.isConnected)
                this.startClockTimer();
        }, delay);
    }
    startDayRolloverTimer() {
        if (this._dayRolloverTimerId !== undefined)
            clearTimeout(this._dayRolloverTimerId);
        if (!this._config || this._config.start_day_entity !== undefined)
            return;
        const nextMidnight = new Date();
        nextMidnight.setHours(24, 0, 0, 50);
        this._dayRolloverTimerId = window.setTimeout(() => {
            this._dayRolloverTimerId = undefined;
            if (this.isConnected && this.onNewStartDate(new Date()))
                void this.loadEvents(true);
            if (this.isConnected)
                this.startDayRolloverTimer();
        }, nextMidnight.getTime() - Date.now());
    }
    updateNowLine() {
        if (!this._config)
            return;
        const now = new Date();
        const startMinutes = parseTime(this._config.start_time);
        const endMinutes = parseTime(this._config.end_time);
        const todayKey = localDateKey(now);
        this.querySelectorAll('.day-column').forEach((column) => {
            const top = this._config.show_now_line && column.dataset.day === todayKey
                ? nowLineTopPercent(now, now, startMinutes, endMinutes)
                : undefined;
            const line = column.querySelector('.now-line');
            if (top === undefined) {
                line?.remove();
            }
            else if (line) {
                line.style.top = `${top}%`;
            }
            else {
                const timeline = column.querySelector('.timeline');
                if (timeline) {
                    const newLine = document.createElement('div');
                    newLine.className = 'now-line';
                    newLine.style.top = `${top}%`;
                    timeline.appendChild(newLine);
                }
            }
        });
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
    resolveStartDay(now = new Date()) {
        return startDayForEntityState(this._config?.start_day_entity === undefined ? undefined : this._hass?.states?.[this._config.start_day_entity]?.state, now);
    }
    onNewStartDate(date) {
        const startDay = new Date(date);
        startDay.setHours(0, 0, 0, 0);
        if (this._activeStartDay && sameLocalDay(this._activeStartDay, startDay))
            return false;
        this._activeStartDay = startDay;
        this._requestKey = undefined;
        return true;
    }
    async loadEvents(force = false) {
        if (!this._config || !this._hass)
            return;
        const range = eventRangeForDays(this._activeStartDay ?? this.resolveStartDay(), this._config.days, this._config.skip_days);
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
    showEventDetails(eventIndex) {
        const loadedEvent = this._events[eventIndex];
        if (!loadedEvent)
            return;
        const locationMapEnabled = this._config?.show_location_map === true &&
            this._config.location_map_provider !== undefined;
        const dialogParams = {
            calendarName: loadedEvent.calendar.label ?? loadedEvent.calendar.entity,
            calendarColor: safeColor(loadedEvent.calendar.color),
            showLocationMap: locationMapEnabled,
            locationMapProvider: this._config?.location_map_provider,
            customNominatimUrl: this._config?.custom_nominatim_url,
            isDarkTheme: this._hass?.themes?.darkMode === true,
            event: loadedEvent.event,
        };
        this.dispatchEvent(new CustomEvent('show-dialog', {
            bubbles: true,
            composed: true,
            detail: {
                dialogTag: 'multiday-calendar-event-dialog',
                dialogImport: async () => undefined,
                dialogParams,
            },
        }));
    }
    bindEventActions() {
        if (this._config?.tap_action.action !== 'more-info')
            return;
        this.querySelectorAll('[data-event-index]').forEach((element) => {
            const showDetails = () => this.showEventDetails(Number(element.dataset.eventIndex));
            element.addEventListener('click', showDetails);
            element.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    showDetails();
                }
            });
        });
    }
    cancelLookAroundReset() {
        if (this._lookAroundResetTimerId !== undefined) {
            clearTimeout(this._lookAroundResetTimerId);
            this._lookAroundResetTimerId = undefined;
        }
        if (this._lookAroundScrollEndTimerId !== undefined) {
            clearTimeout(this._lookAroundScrollEndTimerId);
            this._lookAroundScrollEndTimerId = undefined;
        }
    }
    resetLookAround() {
        const viewport = this.querySelector('.calendar-viewport.look-around');
        if (!viewport)
            return;
        if (this._lookAroundAnchorDay !== undefined) {
            this._lookAroundAnchorDay = undefined;
            this.render();
            return;
        }
        viewport.scrollTo({ left: LOOK_AROUND_BUFFER_DAYS * (viewport.clientWidth / this._config.days), behavior: 'smooth' });
    }
    scheduleLookAroundReset() {
        if (this._lookAroundResetTimerId !== undefined)
            clearTimeout(this._lookAroundResetTimerId);
        this._lookAroundResetTimerId = window.setTimeout(() => {
            this._lookAroundResetTimerId = undefined;
            this.resetLookAround();
        }, LOOK_AROUND_RESET_DELAY_MS);
    }
    bindLookAround() {
        if (this._config?.look_around !== true)
            return;
        const viewport = this.querySelector('.calendar-viewport.look-around');
        if (!viewport)
            return;
        const dayWidth = () => viewport.clientWidth / this._config.days;
        const center = () => LOOK_AROUND_BUFFER_DAYS * dayWidth();
        requestAnimationFrame(() => { viewport.scrollLeft = center(); });
        const settle = () => {
            const firstVisibleIndex = Math.round(viewport.scrollLeft / dayWidth());
            if (shouldRecenterLookAround(firstVisibleIndex)) {
                const anchor = this._lookAroundAnchorDay ?? visibleDays(this._activeStartDay ?? this.resolveStartDay(), this._config.days, this._config.skip_days)[0];
                const offset = firstVisibleIndex - LOOK_AROUND_BUFFER_DAYS;
                this._lookAroundAnchorDay = offset >= 0
                    ? visibleDays(anchor, offset + 1, this._config.skip_days)[offset]
                    : visibleDaysBefore(anchor, -offset, this._config.skip_days)[0];
                this.render();
                return;
            }
            this.scheduleLookAroundReset();
        };
        viewport.addEventListener('scroll', () => {
            if (this._lookAroundScrollEndTimerId !== undefined)
                clearTimeout(this._lookAroundScrollEndTimerId);
            this._lookAroundScrollEndTimerId = window.setTimeout(settle, 120);
        });
        viewport.addEventListener('scrollend', settle);
    }
    render() {
        if (!this._config)
            return;
        const config = this._config;
        const now = new Date();
        const range = eventRangeForDays(this._activeStartDay ?? this.resolveStartDay(now), config.days, config.skip_days);
        const locale = this._hass?.locale?.language ?? navigator.language ?? 'en';
        const startMinutes = parseTime(config.start_time);
        const endMinutes = parseTime(config.end_time);
        const minutesVisible = endMinutes - startMinutes;
        const visibleHours = minutesVisible / 60;
        const geometry = timelineGeometry(visibleHours, config.slot_minutes, config.hour_height);
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
        const days = visibleDays(range.start, config.days, config.skip_days);
        const lookAroundAnchorDay = this._lookAroundAnchorDay ?? days[0];
        const lookAroundDays = config.look_around
            ? [
                ...visibleDaysBefore(lookAroundAnchorDay, LOOK_AROUND_BUFFER_DAYS, config.skip_days),
                ...visibleDays(lookAroundAnchorDay, LOOK_AROUND_BUFFER_DAYS * 2 + config.days, config.skip_days),
            ]
            : days;
        const hasLeadingSkippedDays = hasSkippedDaysBeforeFirstVisibleDay(range.start, days[0]);
        const dayHeaderHeight = calendarHeaderHeight(Math.max(0, ...lookAroundDays.map((day) => this._events.filter(({ event }) => allDayEventPlacementForDay(event, day) !== undefined).length)));
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
        const dayColumns = lookAroundDays
            .map((day, index) => {
            const hasSkippedDaysAfter = index < lookAroundDays.length - 1 && hasSkippedDaysBetween(day, lookAroundDays[index + 1]);
            const allDayPlacements = this._events
                .map(({ calendar, event }, eventIndex) => ({
                calendar,
                eventIndex,
                placement: allDayEventPlacementForDay(event, day),
            }))
                .filter((item) => item.placement !== undefined);
            const allDayEvents = allDayPlacements
                .map(({ calendar, eventIndex, placement }) => {
                const calendarName = calendar.label ?? calendar.entity;
                const interactive = config.tap_action.action === 'more-info';
                return `<div class="all-day-event${interactive ? ' interactive-event' : ''}"${interactive ? ` data-event-index="${eventIndex}" role="button" tabindex="0"` : ''} style="--event-color: ${safeColor(calendar.color)}" title="${escapeHtml(`${placement.summary} — ${calendarName}`)}">${escapeHtml(placement.summary)}</div>`;
            })
                .join('');
            const placements = this._events
                .map(({ calendar, event }, eventIndex) => ({
                calendar,
                eventIndex,
                placement: eventPlacementForDay(event, day, startMinutes, endMinutes),
            }))
                .filter((item) => item.placement !== undefined);
            const laneLayout = layoutTimedEventLanes(placements.map(({ calendar, eventIndex, placement }) => ({
                event: { calendar, eventIndex, placement },
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
                .map(({ event: { calendar, eventIndex, placement }, lane, laneCount }) => {
                const calendarName = calendar.label ?? calendar.entity;
                const interactive = config.tap_action.action === 'more-info';
                return `<div class="event${interactive ? ' interactive-event' : ''}"${interactive ? ` data-event-index="${eventIndex}" role="button" tabindex="0"` : ''} style="${eventStyle(placement.startMinutes, placement.durationMinutes, lane, laneCount)}; --event-color: ${safeColor(calendar.color)}" title="${escapeHtml(`${placement.summary} — ${calendarName}`)}">
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
            const nowLineTop = config.show_now_line
                ? nowLineTopPercent(day, now, startMinutes, endMinutes)
                : undefined;
            const nowLine = nowLineTop === undefined
                ? ''
                : `<div class="now-line" style="top: ${nowLineTop}%"></div>`;
            return `<section class="day-column${hasSkippedDaysAfter ? ' skipped-days-after' : ''}" data-day="${localDateKey(day)}">
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
        const titlePlacement = cardTitlePlacement(config.title, fixedHeight);
        const accessibleTitle = title ?? 'Multi-day calendar';
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
      <ha-card class="${fixedHeight ? 'fixed-height' : ''}"${fixedHeight ? ` style="height: ${config.height}px"` : ''}${titlePlacement.cardHeader ? ` header="${escapeHtml(titlePlacement.cardHeader)}"` : ''}>
        <div class="wrapper ${fixedHeight ? 'fixed-height' : ''}">
          ${titlePlacement.bodyTitle ? `<h1 class="fixed-height-title">${escapeHtml(titlePlacement.bodyTitle)}</h1>` : ''}
          ${status}
          <div class="schedule ${fixedHeight ? 'fixed-height' : ''}" role="grid" aria-label="${escapeHtml(accessibleTitle)}">
            <div class="time-axis ${fixedHeight ? 'fixed-height' : ''}" style="--day-header-height: ${dayHeaderHeight}px;${fixedHeight ? '' : ` height: ${timelineHeight + dayHeaderHeight}px;`}">
              <div class="time-axis-spacer"></div>
              <div class="time-labels">${timeLabels}</div>
            </div>
            ${config.look_around
            ? `<div class="calendar-viewport look-around">
                  <div class="day-columns${hasLeadingSkippedDays ? ' skipped-days-before' : ''} ${fixedHeight ? 'fixed-height' : ''} look-around">${dayColumns}</div>
                </div>`
            : `<div class="day-columns${hasLeadingSkippedDays ? ' skipped-days-before' : ''} ${fixedHeight ? 'fixed-height' : ''}">${dayColumns}</div>`}
          </div>
        </div>
      </ha-card>
    `;
        const style = document.createElement('style');
        style.textContent = `
      ha-card { display: block; }
      .wrapper { padding: ${CALENDAR_VISUAL_LAYOUT.paddingLeftPx}px ${CALENDAR_VISUAL_LAYOUT.paddingRightPx}px 12px ${CALENDAR_VISUAL_LAYOUT.paddingLeftPx}px; overflow-x: auto; }
      .wrapper.fixed-height { box-sizing: border-box; height: 100%; display: flex; flex-direction: column; }
      .fixed-height-title { flex: 0 0 auto; margin: 8px 0 16px; font-size: 24px; font-weight: 400; line-height: 1.2; }
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
      .calendar-viewport { min-width: 0; }
      .calendar-viewport.look-around { overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; scroll-snap-type: x mandatory; }
      .day-columns { min-width: 0; display: grid; grid-template-columns: repeat(${config.days}, minmax(140px, 1fr)); border-left: 1px solid var(--divider-color); }
      .day-columns.look-around { grid-template-columns: repeat(${lookAroundDays.length}, minmax(140px, calc(100% / ${config.days}))); }
      .day-columns.look-around .day-column { scroll-snap-align: start; scroll-snap-stop: always; }
      .day-columns.skipped-days-before { border-left-width: 2px; }
      .day-columns.fixed-height { height: 100%; }
      .day-column { min-width: 0; border-right: 1px solid var(--divider-color); }
      .day-column.skipped-days-after { border-right-width: 3px; }
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
      .interactive-event { cursor: pointer; }
      .interactive-event:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
      .event-summary { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .event-calendar { color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .now-line { position: absolute; left: 0; right: 0; height: 2px; background: var(--error-color); z-index: 2; pointer-events: none; }
      @media (max-width: 600px) { .wrapper { padding: 8px; } .schedule { min-width: 380px; } .time-label { right: ${CALENDAR_VISUAL_LAYOUT.axisLabelGapPx}px; font-size: 0.75rem; } .event-calendar { display: none; } }
    `;
        style.setAttribute('data-multiday-calendar-card', '');
        this.appendChild(style);
        this.bindEventActions();
        if (config.look_around)
            this.bindLookAround();
    }
}
customElements.define('multiday-calendar-card', MultiDayCalendarCard);
window.customCards = window.customCards || [];
window.customCards.push({
    type: 'multiday-calendar-card',
    name: 'Multiday Calendar Card',
    description: 'Read-only multi-day schedule card for Home Assistant calendars.',
});

export { nowLineTopPercent };
//# sourceMappingURL=multiday-calendar-card.js.map
