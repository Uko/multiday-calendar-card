import {
  averageEventColors,
  allDayEventPlacementForDay,
  buildCalendarEventsPath,
  CALENDAR_FETCH_RECOVERY_DELAY_MS,
  calendarHeaderHeight,
  cardTitlePlacement,
  displayTitle,
  eventPlacementForDay,
  eventRangeForDays,
  hasSkippedDaysBetween,
  hasSkippedDaysBeforeFirstVisibleDay,
  layoutTimedEventLanes,
  normalizeSkipDays,
  refreshIntervalMs,
  shouldRetryCalendarFetch,
  shouldRefreshAfterVisibility,
  startDayForEntityState,
  timelineGeometry,
  visibleDays,
  visibleDaysBefore,
  type CalendarApiEvent,
  type DayName,
} from './calendar-model';
import { CALENDAR_VISUAL_LAYOUT, timeAxisWidthPx } from './visual-layout';
import { parseTime } from './editor-model';
import {
  LOOK_AROUND_BUFFER_DAYS,
  LOOK_AROUND_ORIGIN_SNAP_DISTANCE_PX,
  LOOK_AROUND_RESET_DELAY_MS,
  shouldRecenterLookAround,
} from './look-around-model';
import { normalizeTapAction, type EventAction } from './event-interaction';
import { LOCATION_MAP_PROVIDERS, type LocationMapProvider } from './event-detail-model';
import type { EventDetailDialogParams } from './multiday-calendar-event-dialog';
import './multiday-calendar-event-dialog';
import './multiday-calendar-card-editor';

export {};

type HomeAssistantLike = {
  locale?: { language?: string };
  themes?: { darkMode?: boolean };
  connection?: HomeAssistantConnection;
  states?: Record<string, { state?: unknown }>;
  callApi<T>(method: string, path: string): Promise<T>;
};

type HomeAssistantConnection = {
  addEventListener(type: 'ready', listener: () => void): void;
  removeEventListener(type: 'ready', listener: () => void): void;
};

type CalendarConfig = {
  entity: string;
  color?: string;
  label?: string;
};

type MultiDayCalendarCardConfig = {
  type: string;
  title?: string;
  days?: number;
  /** Optional entity whose date state determines the first displayed day. */
  start_day_entity?: string;
  calendars?: CalendarConfig[];
  start_time?: string;
  end_time?: string;
  slot_minutes?: number;
  /** Minutes between calendar API refreshes. */
  refresh_interval?: number;
  /** Fixed outer-card height in pixels. When present, fixed packing takes precedence over hour_height. */
  height?: number | null;
  /** Timeline height in pixels per visible hour when height is omitted. Defaults to 56. */
  hour_height?: number;
  /** Enable a temporary horizontal drag viewport around the configured start day. */
  look_around?: boolean;
  show_now_line?: boolean;
  /** Two-letter weekday names to omit from the display, for example ['sa', 'su']. */
  skip_days?: DayName[];
  /** Maximum concurrent timed-event lanes per overlap group. */
  max_simultaneous_events?: number;
  /** Action applied when a calendar event is tapped. */
  tap_action?: EventAction;
  /** Whether event locations may be sent to the configured provider and shown on a map. */
  show_location_map?: boolean;
  location_map_provider?: LocationMapProvider;
  custom_nominatim_url?: string;
};

type LoadedEvent = {
  calendar: CalendarConfig;
  event: CalendarApiEvent;
};

declare global {
  interface Window {
    customCards?: Array<{
      type: string;
      name: string;
      description: string;
    }>;
  }
}

type NormalizedCardConfig = Required<
  Omit<MultiDayCalendarCardConfig, 'type' | 'title' | 'start_day_entity' | 'location_map_provider' | 'custom_nominatim_url'>
> & Pick<MultiDayCalendarCardConfig, 'type' | 'title' | 'start_day_entity' | 'location_map_provider' | 'custom_nominatim_url'>;

const DEFAULT_CONFIG: Omit<NormalizedCardConfig, 'type' | 'title'> = {
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character];
  });
}

function safeColor(color: string | undefined): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : 'var(--primary-color)';
}

function locationMapProvider(value: unknown): LocationMapProvider | undefined {
  return typeof value === 'string' && LOCATION_MAP_PROVIDERS.includes(value as LocationMapProvider)
    ? value as LocationMapProvider
    : undefined;
}

function customNominatimUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function sameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function nowLineTopPercent(
  day: Date,
  now: Date,
  startMinutes: number,
  endMinutes: number,
): number | undefined {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (!sameLocalDay(day, now) || nowMinutes < startMinutes || nowMinutes >= endMinutes) {
    return undefined;
  }
  return ((nowMinutes - startMinutes) / (endMinutes - startMinutes)) * 100;
}

class MultiDayCalendarCard extends HTMLElement {
  static getConfigElement(): HTMLElement {
    return document.createElement('multiday-calendar-card-editor');
  }

  static getStubConfig(): MultiDayCalendarCardConfig {
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

  private _config?: NormalizedCardConfig;
  private _hass?: HomeAssistantLike;
  private _events: LoadedEvent[] = [];
  private _loading = false;
  private _error?: string;
  private _requestKey?: string;
  private _refreshTimerId?: number;
  private _clockTimerId?: number;
  private _recoveryTimerId?: number;
  private _failedFetchAttempts = 0;
  private _lastEventsUpdateMs = 0;
  private _connection?: HomeAssistantConnection;
  private _activeStartDay?: Date;
  private _dayRolloverTimerId?: number;
  private _lookAroundAnchorDay?: Date;
  private _lookAroundResetTimerId?: number;
  private _lookAroundScrollEndTimerId?: number;
  private _lookAroundAnimationFrameId?: number;
  private _lookAroundResizeObserver?: ResizeObserver;
  private _lookAroundAnimating = false;

  setConfig(config: MultiDayCalendarCardConfig): void {
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

    const maxSimultaneousEvents = Number(
      config.max_simultaneous_events ?? DEFAULT_CONFIG.max_simultaneous_events,
    );
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

  set hass(hass: HomeAssistantLike) {
    const receivedInitialHass = this._hass === undefined;
    this._hass = hass;
    this.watchConnection(hass.connection);
    const startDayChanged = this.onNewStartDate(this.resolveStartDay());
    if (receivedInitialHass) void this.loadEvents(this._error !== undefined);
    else if (this._config?.start_day_entity && startDayChanged) void this.loadEvents();
  }

  getCardSize(): number {
    return 8;
  }

  connectedCallback(): void {
    this.onNewStartDate(this.resolveStartDay());
    this.render();
    this.watchConnection(this._hass?.connection);
    void this.loadEvents();
    this.startRefreshTimer();
    this.startClockTimer();
    this.startDayRolloverTimer();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  disconnectedCallback(): void {
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

  private watchConnection(connection?: HomeAssistantConnection): void {
    if (connection === this._connection) return;
    this._connection?.removeEventListener('ready', this.handleConnectionReady);
    this._connection = connection;
    this._connection?.addEventListener('ready', this.handleConnectionReady);
  }

  private handleConnectionReady = (): void => {
    if (this.isConnected) {
      this.onNewStartDate(this.resolveStartDay());
      void this.loadEvents(true);
    }
  };

  private handleVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') return;
    this.updateNowLine();
    const startDayChanged = this.onNewStartDate(this.resolveStartDay());
    if (startDayChanged || shouldRefreshAfterVisibility(Date.now(), this._lastEventsUpdateMs)) {
      void this.loadEvents(true);
    }
  };

  private startClockTimer(): void {
    if (this._clockTimerId !== undefined) clearTimeout(this._clockTimerId);
    this.updateNowLine();
    const now = new Date();
    const delay = 60_000 - now.getSeconds() * 1_000 - now.getMilliseconds();
    this._clockTimerId = window.setTimeout(() => {
      this._clockTimerId = undefined;
      if (this.isConnected) this.startClockTimer();
    }, delay);
  }

  private startDayRolloverTimer(): void {
    if (this._dayRolloverTimerId !== undefined) clearTimeout(this._dayRolloverTimerId);
    if (!this._config || this._config.start_day_entity !== undefined) return;

    const nextMidnight = new Date();
    nextMidnight.setHours(24, 0, 0, 50);
    this._dayRolloverTimerId = window.setTimeout(() => {
      this._dayRolloverTimerId = undefined;
      if (this.isConnected && this.onNewStartDate(new Date())) void this.loadEvents(true);
      if (this.isConnected) this.startDayRolloverTimer();
    }, nextMidnight.getTime() - Date.now());
  }

  private updateNowLine(): void {
    if (!this._config) return;
    const now = new Date();
    const startMinutes = parseTime(this._config.start_time)!;
    const endMinutes = parseTime(this._config.end_time)!;
    const todayKey = localDateKey(now);

    this.querySelectorAll<HTMLElement>('.day-column').forEach((column) => {
      const top = this._config!.show_now_line && column.dataset.day === todayKey
        ? nowLineTopPercent(now, now, startMinutes, endMinutes)
        : undefined;
      const line = column.querySelector<HTMLElement>('.now-line');
      if (top === undefined) {
        line?.remove();
      } else if (line) {
        line.style.top = `${top}%`;
      } else {
        const timeline = column.querySelector<HTMLElement>('.timeline');
        if (timeline) {
          const newLine = document.createElement('div');
          newLine.className = 'now-line';
          newLine.style.top = `${top}%`;
          timeline.appendChild(newLine);
        }
      }
    });
  }

  private startRefreshTimer(): void {
    if (!this._config) return;
    if (this._refreshTimerId !== undefined) clearTimeout(this._refreshTimerId);

    this._refreshTimerId = window.setTimeout(() => {
      void this.loadEvents(true);
      this.startRefreshTimer();
    }, refreshIntervalMs(this._config.refresh_interval));
  }

  private cancelRecoveryRefresh(): void {
    if (this._recoveryTimerId !== undefined) {
      clearTimeout(this._recoveryTimerId);
      this._recoveryTimerId = undefined;
    }
  }

  private scheduleRecoveryRefresh(): void {
    if (!shouldRetryCalendarFetch(this._failedFetchAttempts)) return;

    this._failedFetchAttempts += 1;
    this.cancelRecoveryRefresh();
    this._recoveryTimerId = window.setTimeout(() => {
      this._recoveryTimerId = undefined;
      if (this.isConnected) void this.loadEvents(true);
    }, CALENDAR_FETCH_RECOVERY_DELAY_MS);
  }

  private resolveStartDay(now = new Date()): Date {
    return startDayForEntityState(
      this._config?.start_day_entity === undefined ? undefined : this._hass?.states?.[this._config.start_day_entity]?.state,
      now,
    );
  }

  private onNewStartDate(date: Date): boolean {
    const startDay = new Date(date);
    startDay.setHours(0, 0, 0, 0);
    if (this._activeStartDay && sameLocalDay(this._activeStartDay, startDay)) return false;
    this._activeStartDay = startDay;
    this._requestKey = undefined;
    return true;
  }

  private async loadEvents(force = false): Promise<void> {
    if (!this._config || !this._hass) return;

    const range = eventRangeForDays(
      this._activeStartDay ?? this.resolveStartDay(),
      this._config.days,
      this._config.skip_days,
    );
    const key = JSON.stringify({
      calendars: this._config.calendars,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    });
    if (!force && key === this._requestKey) return;

    this._requestKey = key;
    this._loading = true;
    this._error = undefined;
    this.render();

    try {
      const eventGroups = await Promise.all(
        this._config.calendars.map(async (calendar) => ({
          calendar,
          events: await this._hass!.callApi<CalendarApiEvent[]>(
            'get',
            buildCalendarEventsPath(calendar.entity, range.start, range.end),
          ),
        })),
      );
      if (this._requestKey !== key) return;

      this._events = eventGroups.flatMap(({ calendar, events }) =>
        events.map((event) => ({ calendar, event })),
      );
      this._lastEventsUpdateMs = Date.now();
      this._failedFetchAttempts = 0;
      this.cancelRecoveryRefresh();
    } catch (error) {
      if (this._requestKey !== key) return;
      this._events = [];
      this._error = error instanceof Error ? error.message : 'Unable to load calendar events';
      this.scheduleRecoveryRefresh();
    } finally {
      if (this._requestKey === key) {
        this._loading = false;
        this.render();
      }
    }
  }

  private showEventDetails(eventIndex: number): void {
    const loadedEvent = this._events[eventIndex];
    if (!loadedEvent) return;
    const locationMapEnabled = this._config?.show_location_map === true &&
      this._config.location_map_provider !== undefined;
    const dialogParams: EventDetailDialogParams = {
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

  private bindEventActions(): void {
    if (this._config?.tap_action.action !== 'more-info') return;
    this.querySelectorAll<HTMLElement>('[data-event-index]').forEach((element) => {
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

  private cancelLookAroundReset(): void {
    if (this._lookAroundResetTimerId !== undefined) {
      clearTimeout(this._lookAroundResetTimerId);
      this._lookAroundResetTimerId = undefined;
    }
    if (this._lookAroundScrollEndTimerId !== undefined) {
      clearTimeout(this._lookAroundScrollEndTimerId);
      this._lookAroundScrollEndTimerId = undefined;
    }
    if (this._lookAroundAnimationFrameId !== undefined) {
      cancelAnimationFrame(this._lookAroundAnimationFrameId);
      this._lookAroundAnimationFrameId = undefined;
    }
    if (this._lookAroundResizeObserver !== undefined) {
      this._lookAroundResizeObserver.disconnect();
      this._lookAroundResizeObserver = undefined;
    }
    this._lookAroundAnimating = false;
  }

  private animateLookAroundScroll(viewport: HTMLElement, left: number): void {
    if (this._lookAroundAnimationFrameId !== undefined) cancelAnimationFrame(this._lookAroundAnimationFrameId);
    const startLeft = viewport.scrollLeft;
    const distance = left - startLeft;
    const startedAt = performance.now();
    const durationMs = 850;
    this._lookAroundAnimating = true;
    const animate = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - ((-2 * progress + 2) ** 2) / 2;
      viewport.scrollLeft = startLeft + distance * eased;
      if (progress < 1) {
        this._lookAroundAnimationFrameId = requestAnimationFrame(animate);
      } else {
        this._lookAroundAnimationFrameId = undefined;
        this._lookAroundAnimating = false;
      }
    };
    this._lookAroundAnimationFrameId = requestAnimationFrame(animate);
  }

  private resetLookAround(): void {
    const viewport = this.querySelector<HTMLElement>('.calendar-viewport.look-around');
    if (!viewport) return;
    if (this._lookAroundAnchorDay !== undefined) {
      this._lookAroundAnchorDay = undefined;
      this.render();
      return;
    }
    const anchor = viewport.querySelector<HTMLElement>('[data-look-around-anchor]');
    const left = anchor === null
      ? viewport.scrollLeft
      : viewport.scrollLeft + anchor.getBoundingClientRect().left - viewport.getBoundingClientRect().left;
    this.animateLookAroundScroll(viewport, left);
  }

  private scheduleLookAroundReset(): void {
    if (this._lookAroundResetTimerId !== undefined) clearTimeout(this._lookAroundResetTimerId);
    this._lookAroundResetTimerId = window.setTimeout(() => {
      this._lookAroundResetTimerId = undefined;
      this.resetLookAround();
    }, LOOK_AROUND_RESET_DELAY_MS);
  }

  private bindLookAround(): void {
    if (this._config?.look_around !== true) return;
    const viewport = this.querySelector<HTMLElement>('.calendar-viewport.look-around');
    if (!viewport) return;

    const columns = (): HTMLElement[] => Array.from(viewport.querySelectorAll<HTMLElement>('.day-column'));
    const anchorColumn = (): HTMLElement | null => viewport.querySelector('[data-look-around-anchor]');
    let startLeft = 0;
    let initialized = false;
    const positionAtStartDay = (): boolean => {
      const anchor = anchorColumn();
      if (!anchor || viewport.scrollWidth <= viewport.clientWidth) return false;
      startLeft = viewport.scrollLeft + anchor.getBoundingClientRect().left - viewport.getBoundingClientRect().left;
      viewport.scrollLeft = startLeft;
      initialized = true;
      this._lookAroundResizeObserver?.disconnect();
      this._lookAroundResizeObserver = undefined;
      return true;
    };
    this._lookAroundResizeObserver?.disconnect();
    this._lookAroundResizeObserver = new ResizeObserver(() => { positionAtStartDay(); });
    this._lookAroundResizeObserver.observe(viewport);
    requestAnimationFrame(() => requestAnimationFrame(positionAtStartDay));
    const settle = (): void => {
      if (!initialized || this._lookAroundAnimating) return;
      if (Math.abs(viewport.scrollLeft - startLeft) <= LOOK_AROUND_ORIGIN_SNAP_DISTANCE_PX) viewport.scrollLeft = startLeft;
      const visibleColumns = columns();
      const visibleIndex = visibleColumns.reduce(
        (nearest, column, index) =>
          Math.abs((viewport.scrollLeft + column.getBoundingClientRect().left - viewport.getBoundingClientRect().left) - viewport.scrollLeft) <
            Math.abs((viewport.scrollLeft + visibleColumns[nearest].getBoundingClientRect().left - viewport.getBoundingClientRect().left) - viewport.scrollLeft)
            ? index
            : nearest,
        0,
      );
      if (shouldRecenterLookAround(visibleIndex)) {
        const anchor = this._lookAroundAnchorDay ?? visibleDays(
          this._activeStartDay ?? this.resolveStartDay(),
          this._config!.days,
          this._config!.skip_days,
        )[0];
        const offset = visibleIndex - LOOK_AROUND_BUFFER_DAYS;
        this._lookAroundAnchorDay = offset >= 0
          ? visibleDays(anchor, offset + 1, this._config!.skip_days)[offset]
          : visibleDaysBefore(anchor, -offset, this._config!.skip_days)[0];
        this.render();
        return;
      }
      this.scheduleLookAroundReset();
    };
    const cancelAnimation = (): void => {
      if (this._lookAroundAnimating) this.cancelLookAroundReset();
    };
    viewport.addEventListener('wheel', cancelAnimation, { passive: true });
    viewport.addEventListener('touchstart', cancelAnimation, { passive: true });
    viewport.addEventListener('pointerdown', cancelAnimation, { passive: true });
    viewport.addEventListener('scroll', () => {
      if (!initialized || this._lookAroundAnimating) return;
      if (this._lookAroundScrollEndTimerId !== undefined) clearTimeout(this._lookAroundScrollEndTimerId);
      this._lookAroundScrollEndTimerId = window.setTimeout(settle, 120);
    });
    viewport.addEventListener('scrollend', settle);
  }

  private render(): void {
    if (!this._config) return;

    const config = this._config;
    const now = new Date();
    const range = eventRangeForDays(
      this._activeStartDay ?? this.resolveStartDay(now),
      config.days,
      config.skip_days,
    );
    const locale = this._hass?.locale?.language ?? navigator.language ?? 'en';
    const startMinutes = parseTime(config.start_time)!;
    const endMinutes = parseTime(config.end_time)!;
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
    const dayHeaderHeight = calendarHeaderHeight(
      Math.max(
        0,
        ...lookAroundDays.map((day) =>
          this._events.filter(({ event }) => allDayEventPlacementForDay(event, day) !== undefined).length,
        ),
      ),
    );

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
    const gridLines = Array.from(
      { length: Math.floor((endMinutes - Math.ceil(startMinutes / config.slot_minutes) * config.slot_minutes) / config.slot_minutes) + 1 },
      (_, index) => Math.ceil(startMinutes / config.slot_minutes) * config.slot_minutes + index * config.slot_minutes,
    )
      .filter((minutes) => minutes > startMinutes && minutes < endMinutes)
      .map((minutes) => `<div class="grid-line" style="top: ${((minutes - startMinutes) / minutesVisible) * 100}%"></div>`)
      .join('');
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const context = document.createElement('canvas').getContext('2d');
    const labelFontSize = rootFontSize * CALENDAR_VISUAL_LAYOUT.textSizeRem;
    if (context) context.font = `${labelFontSize}px ${getComputedStyle(this).fontFamily}`;
    const measuredTimeAxisWidth = timeAxisWidthPx(
      Math.max(...timeLabelValues.map((label) => context?.measureText(label).width ?? 0)),
    );
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
          .filter(
            (item): item is { calendar: CalendarConfig; eventIndex: number; placement: NonNullable<typeof item.placement> } =>
              item.placement !== undefined,
          );
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
            placement: eventPlacementForDay(
              event,
              day,
              startMinutes,
              endMinutes,
            ),
          }))
          .filter(
            (item): item is { calendar: CalendarConfig; eventIndex: number; placement: NonNullable<typeof item.placement> } =>
              item.placement !== undefined,
          );
        const laneLayout = layoutTimedEventLanes(
          placements.map(({ calendar, eventIndex, placement }) => ({
            event: { calendar, eventIndex, placement },
            startMinutes: placement.startMinutes,
            durationMinutes: placement.durationMinutes,
          })),
          config.max_simultaneous_events,
        );
        const eventStyle = (eventStartMinutes: number, durationMinutes: number, lane: number, laneCount: number): string => {
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
        return `<section class="day-column${hasSkippedDaysAfter ? ' skipped-days-after' : ''}" data-day="${localDateKey(day)}"${config.look_around && index === LOOK_AROUND_BUFFER_DAYS ? ' data-look-around-anchor' : ''}>
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
      .time-axis-spacer { height: var(--day-header-height); border-bottom: ${CALENDAR_VISUAL_LAYOUT.timeAxisHeaderDivider ? '1px solid var(--divider-color)' : 'none'}; }
      .time-labels { position: relative; height: calc(100% - var(--day-header-height)); }
      .time-label { position: absolute; right: ${CALENDAR_VISUAL_LAYOUT.axisLabelGapPx}px; transform: translateY(-50%); white-space: nowrap; }
      .time-label:last-child { transform: translateY(-100%); }
      .calendar-viewport { min-width: 0; }
      .calendar-viewport.look-around { overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; }
      .day-columns { min-width: 0; display: grid; grid-template-columns: repeat(${config.days}, minmax(140px, 1fr)); border-left: 1px solid var(--divider-color); }
      .day-columns.look-around { grid-template-columns: repeat(${lookAroundDays.length}, minmax(140px, calc(100% / ${config.days}))); }
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
    if (config.look_around) this.bindLookAround();
  }
}

customElements.define('multiday-calendar-card', MultiDayCalendarCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'multiday-calendar-card',
  name: 'Multiday Calendar Card',
  description: 'Read-only multi-day schedule card for Home Assistant calendars.',
});
