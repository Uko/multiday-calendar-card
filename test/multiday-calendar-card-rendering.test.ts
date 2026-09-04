import { strict as assert } from 'node:assert';
import { test } from 'node:test';

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

await import('../src/multiday-calendar-card');

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
