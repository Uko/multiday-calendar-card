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
  layoutTimedEventLanes,
  refreshIntervalMs,
  shouldRetryCalendarFetch,
  shouldRefreshAfterVisibility,
  timelineGeometry,
  type CalendarApiEvent,
} from './calendar-model';
import { CALENDAR_VISUAL_LAYOUT, timeAxisWidthPx } from './visual-layout';
import { parseTime } from './editor-model';
import './multiday-calendar-card-editor';

export {};

type HomeAssistantLike = {
  locale?: { language?: string };
  callApi<T>(method: string, path: string): Promise<T>;
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
  show_now_line?: boolean;
  /** Maximum concurrent timed-event lanes per overlap group. */
  max_simultaneous_events?: number;
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

const DEFAULT_CONFIG: Required<
  Omit<MultiDayCalendarCardConfig, 'type' | 'title'>
> = {
  days: 2,
  start_time: '06:00',
  end_time: '22:00',
  slot_minutes: 30,
  refresh_interval: 30,
  height: null,
  hour_height: 56,
  show_now_line: true,
  max_simultaneous_events: 3,
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

function sameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
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

  private _config?: Required<
    Omit<MultiDayCalendarCardConfig, 'type' | 'title'>
  > &
    Pick<MultiDayCalendarCardConfig, 'type' | 'title'>;
  private _hass?: HomeAssistantLike;
  private _events: LoadedEvent[] = [];
  private _loading = false;
  private _error?: string;
  private _requestKey?: string;
  private _refreshTimerId?: number;
  private _recoveryTimerId?: number;
  private _failedFetchAttempts = 0;
  private _lastEventsUpdateMs = 0;

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
      start_time: startTime,
      end_time: endTime,
      slot_minutes: slotMinutes,
      refresh_interval: refreshInterval,
      max_simultaneous_events: maxSimultaneousEvents,
      height,
      hour_height: hourHeight,
      calendars,
    };
    this._requestKey = undefined;
    this.cancelRecoveryRefresh();
    this._failedFetchAttempts = 0;
    this.render();
    void this.loadEvents();
    if (this.isConnected) this.startRefreshTimer();
  }

  set hass(hass: HomeAssistantLike) {
    this._hass = hass;
    this.render();
    void this.loadEvents(this._error !== undefined);
  }

  getCardSize(): number {
    return 8;
  }

  connectedCallback(): void {
    this.render();
    void this.loadEvents();
    this.startRefreshTimer();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  disconnectedCallback(): void {
    if (this._refreshTimerId !== undefined) {
      clearTimeout(this._refreshTimerId);
      this._refreshTimerId = undefined;
    }
    this.cancelRecoveryRefresh();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private handleVisibilityChange = (): void => {
    if (
      document.visibilityState === 'visible' &&
      shouldRefreshAfterVisibility(Date.now(), this._lastEventsUpdateMs)
    ) {
      void this.loadEvents(true);
    }
  };

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

  private async loadEvents(force = false): Promise<void> {
    if (!this._config || !this._hass) return;

    const range = eventRangeForDays(new Date(), this._config.days);
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

  private render(): void {
    if (!this._config) return;

    const config = this._config;
    const now = new Date();
    const range = eventRangeForDays(now, config.days);
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

    const days = Array.from({ length: config.days }, (_, index) => {
      const day = new Date(range.start);
      day.setDate(day.getDate() + index);
      return day;
    });
    const dayHeaderHeight = calendarHeaderHeight(
      Math.max(
        0,
        ...days.map((day) =>
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

    const dayColumns = days
      .map((day) => {
        const allDayPlacements = this._events
          .map(({ calendar, event }) => ({
            calendar,
            placement: allDayEventPlacementForDay(event, day),
          }))
          .filter(
            (item): item is { calendar: CalendarConfig; placement: NonNullable<typeof item.placement> } =>
              item.placement !== undefined,
          );
        const allDayEvents = allDayPlacements
          .map(({ calendar, placement }) => {
            const calendarName = calendar.label ?? calendar.entity;
            return `<div class="all-day-event" style="--event-color: ${safeColor(calendar.color)}" title="${escapeHtml(`${placement.summary} — ${calendarName}`)}">${escapeHtml(placement.summary)}</div>`;
          })
          .join('');
        const placements = this._events
          .map(({ calendar, event }) => ({
            calendar,
            placement: eventPlacementForDay(
              event,
              day,
              startMinutes,
              endMinutes,
            ),
          }))
          .filter(
            (item): item is { calendar: CalendarConfig; placement: NonNullable<typeof item.placement> } =>
              item.placement !== undefined,
          );
        const laneLayout = layoutTimedEventLanes(
          placements.map(({ calendar, placement }) => ({
            event: { calendar, placement },
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
        const nowLine =
          config.show_now_line && isToday && now.getHours() * 60 + now.getMinutes() >= startMinutes && now.getHours() * 60 + now.getMinutes() < endMinutes
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
            <div class="day-columns ${fixedHeight ? 'fixed-height' : ''}">${dayColumns}</div>
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
