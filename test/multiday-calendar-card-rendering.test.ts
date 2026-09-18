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
});

const calendarCardModule = await import('../src/multiday-calendar-card');
nowLineTopPercent = calendarCardModule.nowLineTopPercent;

test('now-line position tracks the current minute without re-rendering events', () => {
  const today = new Date(2026, 8, 8, 10, 15);

  assert.equal(nowLineTopPercent(today, today, 6 * 60, 22 * 60), 26.5625);
  assert.equal(nowLineTopPercent(today, new Date(2026, 8, 9, 10, 15), 6 * 60, 22 * 60), undefined);
  assert.equal(nowLineTopPercent(today, new Date(2026, 8, 8, 22, 0), 6 * 60, 22 * 60), undefined);
});

test('onNewStartDate updates the active day only when the local calendar day changes', () => {
  const CalendarCard = elementRegistry.get('multiday-calendar-card');
  assert.ok(CalendarCard);

  const card = new CalendarCard() as FakeHTMLElement & {
    onNewStartDate(date: Date): boolean;
    _lookAroundInitialized: boolean;
  };

  card._lookAroundInitialized = true;
  assert.equal(card.onNewStartDate(new Date(2026, 8, 8, 10, 15)), true);
  assert.equal(card._lookAroundInitialized, false);
  card._lookAroundInitialized = true;
  assert.equal(card.onNewStartDate(new Date(2026, 8, 8, 23, 59)), false);
  assert.equal(card._lookAroundInitialized, true);
  assert.equal(card.onNewStartDate(new Date(2026, 8, 9, 0, 0)), true);
  assert.equal(card._lookAroundInitialized, false);
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
    setConfig(config: { type: string; calendars: Array<{ entity: string }>; days: number; look_around: string }): void;
    hass: { callApi<T>(method: string, path: string): Promise<T> };
    render(): void;
    loadEvents(force?: boolean, days?: readonly Date[]): Promise<void>;
    _activeStartDay: Date;
    _hass: { callApi<T>(method: string, path: string): Promise<T> };
    _eventsByDay: Map<string, unknown>;
  };
  card.render = () => undefined;
  card.setConfig({
    type: 'custom:multiday-calendar-card',
    calendars: [{ entity: 'calendar.work' }],
    days: 2,
    look_around: 'horizontal',
  });
  card._activeStartDay = new Date(2026, 0, 1);
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
  assert.match(requests[0], /start=2026-01-10T00%3A00%3A00.000Z/);
  assert.equal(card._eventsByDay.has('2026-0-10'), true);

  await card.loadEvents(true);
  assert.equal(card._eventsByDay.has('2026-0-10'), false);
  assert.equal(requests.length, 2);
});
