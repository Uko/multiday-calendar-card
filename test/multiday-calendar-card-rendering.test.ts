import { strict as assert } from 'node:assert';
import { test } from 'node:test';

let nowLineTopPercent: (day: Date, now: Date, startMinutes: number, endMinutes: number) => number | undefined;

class FakeHTMLElement {
  isConnected = false;
}

const elementRegistry = new Map<string, typeof FakeHTMLElement>();

Object.assign(globalThis, {
  HTMLElement: FakeHTMLElement,
  customElements: {
    define(name: string, constructor: typeof FakeHTMLElement): void {
      elementRegistry.set(name, constructor);
    },
    get(name: string): typeof FakeHTMLElement | undefined {
      return elementRegistry.get(name);
    },
  },
  window: { customCards: [] },
  document: {
    addEventListener(): void {},
    removeEventListener(): void {},
  },
});

const calendarCardModule = await import('../src/multiday-calendar-card');
nowLineTopPercent = calendarCardModule.nowLineTopPercent;

test('now-line position tracks the current minute without re-rendering events', () => {
  const today = new Date(2026, 8, 8, 10, 15);

  assert.equal(nowLineTopPercent(today, today, 6 * 60, 22 * 60), 26.5625);
  assert.equal(nowLineTopPercent(today, new Date(2026, 8, 9, 10, 15), 6 * 60, 22 * 60), undefined);
  assert.equal(nowLineTopPercent(today, new Date(2026, 8, 8, 22, 0), 6 * 60, 22 * 60), undefined);
});

test('advanceStartDay rebuilds the calendar only when the local date changes', () => {
  const CalendarCard = elementRegistry.get('multiday-calendar-card');
  assert.ok(CalendarCard);

  const card = new CalendarCard() as FakeHTMLElement & {
    advanceStartDay(date: Date): boolean;
    render(): void;
    _config: unknown;
    _lookAroundInitialized: boolean;
  };
  let renderCount = 0;
  card.render = () => { renderCount += 1; };
  card._config = {};

  card._lookAroundInitialized = true;
  assert.equal(card.advanceStartDay(new Date(2026, 8, 8, 10, 15)), true);
  assert.equal(renderCount, 1);
  assert.equal(card._lookAroundInitialized, false);
  card._lookAroundInitialized = true;
  assert.equal(card.advanceStartDay(new Date(2026, 8, 8, 23, 59)), false);
  assert.equal(renderCount, 1);
  assert.equal(card._lookAroundInitialized, true);
  assert.equal(card.advanceStartDay(new Date(2026, 8, 9, 0, 0)), true);
  assert.equal(renderCount, 2);
  assert.equal(card._lookAroundInitialized, false);
});

test('reattaching the card resets look-around before dashboard edit-mode rendering', () => {
  const CalendarCard = elementRegistry.get('multiday-calendar-card');
  assert.ok(CalendarCard);

  const card = new CalendarCard() as FakeHTMLElement & {
    connectedCallback(): void;
    _lookAroundInitialized: boolean;
    advanceStartDay(date: Date): boolean;
    render(): void;
    watchConnection(): void;
    loadEvents(): Promise<void>;
    startRefreshTimer(): void;
    startClockTimer(): void;
    startDayRolloverTimer(): void;
  };
  let renderCount = 0;
  card._lookAroundInitialized = true;
  card.advanceStartDay = () => false;
  card.render = () => { renderCount += 1; };
  card.watchConnection = () => undefined;
  card.loadEvents = async () => undefined;
  card.startRefreshTimer = () => undefined;
  card.startClockTimer = () => undefined;
  card.startDayRolloverTimer = () => undefined;

  card.connectedCallback();

  assert.equal(card._lookAroundInitialized, false);
  assert.equal(renderCount, 1);
});

test('configured start_day_entity reloads only when its calendar date changes', () => {
  const CalendarCard = elementRegistry.get('multiday-calendar-card');
  assert.ok(CalendarCard);

  const card = new CalendarCard() as FakeHTMLElement & {
    setConfig(config: { type: string; calendars: []; start_day_entity: string }): void;
    hass: { states: Record<string, { state: string }>; callApi<T>(method: string, path: string): Promise<T> };
    render(): void;
    loadEvents(force?: boolean): Promise<void>;
  };
  const reloads: boolean[] = [];
  card.render = () => undefined;
  card.loadEvents = async (force = false) => { reloads.push(force); };
  card.setConfig({ type: 'custom:multiday-calendar-card', calendars: [], start_day_entity: 'input_datetime.calendar_start' });
  reloads.length = 0;

  card.hass = { states: { 'input_datetime.calendar_start': { state: '2026-09-08' } }, callApi: async <T>() => [] as T };
  reloads.length = 0;
  card.hass = { states: { 'input_datetime.calendar_start': { state: '2026-09-08 20:00:00' } }, callApi: async <T>() => [] as T };
  assert.deepEqual(reloads, []);

  card.hass = { states: { 'input_datetime.calendar_start': { state: '2026-09-09' } }, callApi: async <T>() => [] as T };
  assert.deepEqual(reloads, [false]);
});

test('repeated equivalent card configuration does not recreate the calendar during editor updates', () => {
  const CalendarCard = elementRegistry.get('multiday-calendar-card');
  assert.ok(CalendarCard);

  const card = new CalendarCard() as FakeHTMLElement & {
    setConfig(config: { type: string; calendars: [] }): void;
    render(): void;
    loadEvents(force?: boolean): Promise<void>;
  };
  let renderCount = 0;
  let loadCount = 0;
  card.render = () => { renderCount += 1; };
  card.loadEvents = async () => { loadCount += 1; };
  const config = { type: 'custom:multiday-calendar-card', calendars: [] };

  card.setConfig(config);
  renderCount = 0;
  loadCount = 0;
  card.setConfig({ ...config, calendars: [] });

  assert.equal(renderCount, 0);
  assert.equal(loadCount, 0);
});

test('Home Assistant state updates do not re-render the calendar', () => {
  const CalendarCard = elementRegistry.get('multiday-calendar-card');
  assert.ok(CalendarCard);

  const card = new CalendarCard() as FakeHTMLElement & {
    hass: { callApi<T>(method: string, path: string): Promise<T> };
    render(): void;
  };
  let renderCount = 0;
  card.render = () => {
    renderCount += 1;
  };
  Object.assign(card as unknown as { _hass?: unknown }, {
    _hass: { callApi: async <T>() => [] as T },
  });

  card.hass = { callApi: async <T>() => [] as T };
  card.hass = { callApi: async <T>() => [] as T };

  assert.equal(renderCount, 0);
});

test('Home Assistant reconnect refreshes calendar events without re-rendering the card', () => {
  const CalendarCard = elementRegistry.get('multiday-calendar-card');
  assert.ok(CalendarCard);

  const readyListeners = new Set<() => void>();
  const connection = {
    addEventListener(type: string, listener: () => void): void {
      if (type === 'ready') readyListeners.add(listener);
    },
    removeEventListener(type: string, listener: () => void): void {
      if (type === 'ready') readyListeners.delete(listener);
    },
  };
  const card = new CalendarCard() as FakeHTMLElement & {
    hass: { callApi<T>(method: string, path: string): Promise<T>; connection: typeof connection };
    render(): void;
    loadEvents(force?: boolean): Promise<void>;
  };
  const reloads: boolean[] = [];
  let renderCount = 0;
  card.render = () => {
    renderCount += 1;
  };
  card.loadEvents = async (force = false) => {
    reloads.push(force);
  };
  Object.assign(card, { isConnected: true });

  card.hass = { callApi: async <T>() => [] as T, connection };
  reloads.length = 0;
  readyListeners.forEach((listener) => listener());

  assert.deepEqual(reloads, [true]);
  assert.equal(renderCount, 0);
});

test('look-around caches an exposed day, avoids duplicate requests, and evicts it on normal refresh', async () => {
  const CalendarCard = elementRegistry.get('multiday-calendar-card');
  assert.ok(CalendarCard);

  const requests: string[] = [];
  const card = new CalendarCard() as FakeHTMLElement & {
    setConfig(config: { type: string; calendars: Array<{ entity: string }>; days: number; look_around: { mode: 'horizontal' } }): void;
    hass: { callApi<T>(method: string, path: string): Promise<T> };
    render(): void;
    loadEvents(force?: boolean, days?: readonly Date[]): Promise<void>;
    updateLoadedDayColumns(dayKeys: readonly string[]): void;
    updateLoadingIndicator(): void;
    _activeStartDay: Date;
    _hass: { callApi<T>(method: string, path: string): Promise<T> };
    _eventsByDay: Map<string, unknown>;
  };
  let renderCount = 0;
  const patchedDays: string[][] = [];
  const loadingTransitions: boolean[] = [];
  card.render = () => { renderCount += 1; };
  card.updateLoadedDayColumns = (dayKeys) => { patchedDays.push([...dayKeys]); };
  card.updateLoadingIndicator = () => { loadingTransitions.push((card as unknown as { _loading: boolean })._loading); };
  card.setConfig({
    type: 'custom:multiday-calendar-card',
    calendars: [{ entity: 'calendar.work' }],
    days: 2,
    look_around: { mode: 'horizontal' },
  });
  card._activeStartDay = new Date(2026, 0, 1);
  renderCount = 0;
  loadingTransitions.length = 0;
  card._hass = {
    callApi: async <T>(_method: string, path: string) => {
      requests.push(path);
      return [] as T;
    },
  };

  const pannedDay = new Date(2026, 0, 10);
  await card.loadEvents(false, [pannedDay]);
  await card.loadEvents(false, [pannedDay]);
  assert.equal(requests.length, 1);
  assert.equal(renderCount, 0);
  assert.deepEqual(loadingTransitions, [true, false]);
  assert.deepEqual(patchedDays, [['2026-0-10']]);
  assert.match(requests[0], /start=2026-01-10T00%3A00%3A00.000Z/);
  assert.equal(card._eventsByDay.has('2026-0-10'), true);

  await card.loadEvents(true);
  assert.equal(card._eventsByDay.has('2026-0-10'), false);
  assert.equal(requests.length, 2);
  assert.deepEqual(loadingTransitions, [true, false, true, false]);
});

test('an invalidated request cannot clear a replacement request loading ownership', async () => {
  const CalendarCard = elementRegistry.get('multiday-calendar-card');
  assert.ok(CalendarCard);

  let resolveFirstRequest!: (events: []) => void;
  let resolveSecondRequest!: (events: []) => void;
  const firstRequest = new Promise<[]>((resolve) => { resolveFirstRequest = resolve; });
  const secondRequest = new Promise<[]>((resolve) => { resolveSecondRequest = resolve; });
  let requestCount = 0;
  const card = new CalendarCard() as FakeHTMLElement & {
    setConfig(config: { type: string; calendars: Array<{ entity: string }>; days: number }): void;
    render(): void;
    loadEvents(force?: boolean, days?: readonly Date[]): Promise<void>;
    invalidateEventCache(): void;
    updateLoadingIndicator(): void;
    updateLoadedDayColumns(dayKeys: readonly string[]): void;
    _activeStartDay: Date;
    _hass: { callApi<T>(method: string, path: string): Promise<T> };
    _loadingDays: Set<string>;
    _loading: boolean;
  };
  card.render = () => undefined;
  card.setConfig({
    type: 'custom:multiday-calendar-card',
    calendars: [{ entity: 'calendar.work' }],
    days: 1,
  });
  card._activeStartDay = new Date(2026, 0, 1);
  card.updateLoadingIndicator = () => undefined;
  card.updateLoadedDayColumns = () => undefined;
  card._hass = {
    callApi: <T>() => {
      requestCount += 1;
      return (requestCount === 1 ? firstRequest : secondRequest) as Promise<T>;
    },
  };

  const day = new Date(2026, 0, 1);
  const staleLoad = card.loadEvents(false, [day]);
  card.invalidateEventCache();
  const currentLoad = card.loadEvents(false, [day]);

  resolveFirstRequest([]);
  await staleLoad;

  assert.equal(card._loadingDays.has('2026-0-1'), true);
  assert.equal(card._loading, true);

  resolveSecondRequest([]);
  await currentLoad;
  assert.equal(card._loadingDays.has('2026-0-1'), false);
  assert.equal(card._loading, false);
});
