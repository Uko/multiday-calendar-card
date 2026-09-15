import {
  formatTime,
  GRID_INTERVALS,
  editorWarnings,
  normalizeEditorConfig,
  parseTime,
  validateEditorConfig,
  type CalendarEditorConfig,
  type EditorConfig,
} from './editor-model';
import { type EventAction } from './event-interaction';
import { DAY_NAMES, type DayName } from './calendar-model';

type HomeAssistantLike = {
  states?: Record<string, unknown>;
};

type EntityPicker = HTMLElement & {
  hass?: HomeAssistantLike;
  value?: string;
  includeDomains?: string[];
};

type ActionEditorForm = HTMLElement & {
  hass?: HomeAssistantLike;
  data?: {
    tap_action?: EventAction;
    show_location_map?: boolean;
    location_map_provider?: 'google_maps' | 'osm_nominatim';
    custom_nominatim_url?: string;
  };
  schema?: unknown;
  computeLabel?: (schema: { name: string }) => string;
};

const CARD_TYPE = 'custom:multiday-calendar-card';

function interactionSchema(showMoreInfo: boolean, showLocationMap: boolean, provider?: string): unknown[] {
  const schema: unknown[] = [
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

function numberValue(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export class MultidayCalendarCardEditor extends HTMLElement {
  private _config: EditorConfig = { type: CARD_TYPE, calendars: [] };
  private _hass?: HomeAssistantLike;

  connectedCallback(): void {
    void this.loadEntityPicker();
  }

  private async loadEntityPicker(): Promise<void> {
    if (customElements.get('ha-entity-picker')) return;
    const entitiesCard = customElements.get('hui-entities-card') as
      | { getConfigElement?: () => Promise<unknown> }
      | undefined;
    if (!entitiesCard?.getConfigElement) return;
    try {
      await entitiesCard.getConfigElement();
      this.render();
    } catch {
      // The fallback remains an empty picker until Home Assistant provides the element.
    }
  }

  setConfig(config: EditorConfig): void {
    this._config = normalizeEditorConfig({ ...config, type: CARD_TYPE });
    this.render();
  }

  set hass(hass: HomeAssistantLike) {
    this._hass = hass;
    this.assignHassToEntityPickers();
    this.renderInteractionEditor();
  }

  private updateConfig(update: Partial<EditorConfig>, rerender = false): void {
    this._config = normalizeEditorConfig({ ...this._config, ...update });
    this.updateValidation();
    if (validateEditorConfig(this._config).length === 0) {
      this.dispatchEvent(new CustomEvent('config-changed', {
        bubbles: true,
        composed: true,
        detail: { config: this._config },
      }));
    }
    if (rerender) this.render();
  }

  private setCalendar(index: number, update: Partial<CalendarEditorConfig>): void {
    const calendars = (this._config.calendars ?? []).map((calendar, row) =>
      row === index ? { ...calendar, ...update } : calendar,
    );
    this.updateConfig({ calendars });
  }

  private assignHassToEntityPickers(): void {
    this.querySelectorAll<EntityPicker>('.calendar-row ha-entity-picker').forEach((picker) => {
      picker.hass = this._hass;
      picker.includeDomains = ['calendar'];
      picker.value = picker.getAttribute('value') ?? '';
    });
    const startPicker = this.querySelector<EntityPicker>('[data-config="start_day_entity"]');
    if (startPicker) {
      startPicker.hass = this._hass;
      startPicker.includeDomains = ['input_datetime'];
      startPicker.value = startPicker.getAttribute('value') ?? '';
    }
  }

  private renderInteractionEditor(): void {
    const target = this.querySelector<HTMLElement>('[data-interaction-editor]');
    if (!target) return;
    const editor = document.createElement('ha-form') as ActionEditorForm;
    editor.hass = this._hass;
    editor.data = {
      tap_action: this._config.tap_action,
      show_location_map: this._config.show_location_map === true,
      location_map_provider: this._config.location_map_provider,
      custom_nominatim_url: this._config.custom_nominatim_url,
    };
    editor.schema = interactionSchema(
      this._config.tap_action?.action === 'more-info',
      this._config.show_location_map === true,
      this._config.location_map_provider,
    );
    editor.computeLabel = (schema) => {
      if (schema.name === 'tap_action') return 'Tap behaviour (optional)';
      if (schema.name === 'show_location_map') {
        return 'Resolve event location with an external geocoding provider (your location data will be sent to an external service to convert the event address into coordinates)';
      }
      if (schema.name === 'location_map_provider') return 'Map provider';
      if (schema.name === 'custom_nominatim_url') return 'Custom Nominatim URL (optional)';
      return schema.name;
    };
    editor.addEventListener('value-changed', (event) => {
      const value = (event as CustomEvent<{
        value: {
          tap_action?: EventAction;
          show_location_map?: boolean;
          location_map_provider?: 'google_maps' | 'osm_nominatim';
          custom_nominatim_url?: string;
        };
      }>).detail.value;
      this.updateConfig({
        tap_action: value.tap_action ?? this._config.tap_action,
        show_location_map: value.show_location_map === true,
        location_map_provider: value.location_map_provider ?? this._config.location_map_provider,
        custom_nominatim_url: value.custom_nominatim_url?.trim() || undefined,
      }, true);
    });
    target.replaceChildren(editor);
  }

  private updateValidation(): void {
    const errors = validateEditorConfig(this._config);
    const warnings = editorWarnings(this._config);
    const validation = this.querySelector<HTMLElement>('.validation');
    if (!validation) return;
    validation.innerHTML = [
      ...errors.map((message) => `<div class="error">${escapeHtml(message)}</div>`),
      ...warnings.map((message) => `<div class="warning">${escapeHtml(message)}</div>`),
    ].join('');
  }

  private render(): void {
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
            <div class="field"><label>Calendar entity</label><ha-entity-picker data-field="entity" value="${escapeHtml(calendar.entity ?? '')}"></ha-entity-picker></div>
            <div class="remove-field"><span class="remove-label" aria-hidden="true">&nbsp;</span><button class="remove" data-action="remove-calendar" type="button" aria-label="Remove calendar source" title="Remove calendar source"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v1H4v2h1v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9m0 5h2v11H9V8m4 0h2v11h-2V8Z"/></svg></button></div>
            <div class="calendar-details">
              <div class="field"><label>Display label (optional)</label><input data-field="label" value="${escapeHtml(calendar.label ?? '')}" placeholder="Calendar name"></div>
              <div class="field"><label>Event color</label><div class="color-control"><input data-action="pick-color" type="color" value="${/^#[0-9a-f]{6}$/i.test(calendar.color ?? '') ? calendar.color : '#4caf50'}" aria-label="Choose event color"><input data-field="color" value="${escapeHtml(calendar.color ?? '')}" placeholder="#4caf50" pattern="^#[0-9a-fA-F]{6}$"></div></div>
            </div>
          </div>`).join('')}</div>
        <button data-action="add-calendar" type="button">Add calendar</button>
        <div class="hint">Sources may intentionally share a label or color; the editor only warns when they do.</div>
      </section>
      <section class="section">
        <h3>View & schedule</h3>
        <div class="field"><label>Card title</label><input data-config="title" value="${escapeHtml(config.title ?? '')}" placeholder="Calendar"></div>
        <label class="toggle"><input type="checkbox" data-action="hide-title" ${config.title === undefined ? 'checked' : ''}> Hide card title</label>
        <div class="grid">
          <div class="field"><label>Days displayed</label><input data-config="days" type="number" min="1" max="7" step="1" value="${config.days ?? 2}"></div>
          <div class="field"><label>Grid interval</label><select data-config="slot_minutes">${GRID_INTERVALS.map((minutes) => `<option value="${minutes}" ${config.slot_minutes === minutes || (config.slot_minutes === undefined && minutes === 30) ? 'selected' : ''}>${minutes === 120 ? '2 hours' : `${minutes} minutes`}</option>`).join('')}</select></div>
          <div class="field"><label>Start time</label><select data-config="start_time">${parseTime(startTime)! % 60 !== 0 ? `<option value="${startTime}" selected>${startTime} (custom)</option>` : ''}${Array.from({ length: 24 }, (_, hour) => `<option value="${String(hour).padStart(2, '0')}:00" ${startTime === formatTime(hour * 60) ? 'selected' : ''}>${String(hour).padStart(2, '0')}:00</option>`).join('')}</select></div>
          <div class="field"><label>End time</label><select data-config="end_time">${parseTime(endTime)! % 60 !== 0 ? `<option value="${endTime}" selected>${endTime} (custom)</option>` : ''}${Array.from({ length: 24 }, (_, hour) => hour + 1).map((hour) => `<option value="${String(hour).padStart(2, '0')}:00" ${endTime === formatTime(hour * 60) ? 'selected' : ''}>${String(hour).padStart(2, '0')}:00</option>`).join('')}</select></div>
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
        <div class="field"><label>Start day entity (optional)</label><ha-entity-picker data-config="start_day_entity" value="${escapeHtml(config.start_day_entity ?? '')}"></ha-entity-picker><div class="hint">Use an input_datetime with a date. When unset, the calendar starts today.</div></div>
      </section>
      <div class="validation" role="alert"></div>
    `;
    this.bindEvents();
    this.assignHassToEntityPickers();
    this.renderInteractionEditor();
    this.updateValidation();
  }

  private bindEvents(): void {
    this.querySelector('[data-action="add-calendar"]')?.addEventListener('click', () => {
      this.updateConfig({ calendars: [...(this._config.calendars ?? []), { entity: '' }] }, true);
    });
    this.querySelectorAll<HTMLElement>('[data-action="remove-calendar"]').forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.closest<HTMLElement>('[data-calendar-index]')?.dataset.calendarIndex);
      this.updateConfig({ calendars: (this._config.calendars ?? []).filter((_, row) => row !== index) }, true);
    }));
    this.querySelector('[data-action="hide-title"]')?.addEventListener('change', (event) => {
      const hidden = (event.target as HTMLInputElement).checked;
      this.updateConfig(hidden ? { title: undefined } : { title: '' }, true);
    });
    this.querySelector('[data-action="fixed-height"]')?.addEventListener('change', (event) => {
      const fixed = (event.target as HTMLInputElement).checked;
      this.updateConfig({ height: fixed ? 480 : null }, true);
    });
    this.querySelectorAll<HTMLButtonElement>('[data-action="toggle-skip-day"]').forEach((button) => button.addEventListener('click', () => {
      const day = button.dataset.dayName as DayName;
      const skipDays = this._config.skip_days ?? [];
      this.updateConfig({
        skip_days: skipDays.includes(day)
          ? skipDays.filter((value) => value !== day)
          : [...skipDays, day],
      }, true);
    }));
    this.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-config]').forEach((field) => field.addEventListener('change', () => {
      const key = field.dataset.config as keyof EditorConfig;
      const value = field.type === 'checkbox' ? (field as HTMLInputElement).checked :
        field.type === 'number' || ['days', 'slot_minutes', 'max_simultaneous_events'].includes(key as string)
          ? numberValue(field.value)
          : field.value;
      this.updateConfig({ [key]: value });
    }));
    this.querySelector<EntityPicker>('[data-config="start_day_entity"]')?.addEventListener('value-changed', (event) => {
      this.updateConfig({ start_day_entity: (event as CustomEvent<{ value: string }>).detail.value?.trim() || undefined });
    });
    this.querySelectorAll<HTMLElement>('[data-calendar-index]').forEach((row) => {
      const index = Number(row.dataset.calendarIndex);
      row.querySelector<EntityPicker>('ha-entity-picker')?.addEventListener('value-changed', (event) => {
        this.setCalendar(index, { entity: (event as CustomEvent<{ value: string }>).detail.value ?? '' });
      });
      row.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((field) => field.addEventListener('change', () => {
        this.setCalendar(index, { [field.dataset.field!]: field.value.trim() || undefined });
      }));
      row.querySelector<HTMLInputElement>('[data-action="pick-color"]')?.addEventListener('input', (event) => {
        const color = (event.target as HTMLInputElement).value;
        const textField = row.querySelector<HTMLInputElement>('input[data-field="color"]');
        if (textField) textField.value = color;
        this.setCalendar(index, { color });
      });
    });
  }
}

customElements.define('multiday-calendar-card-editor', MultidayCalendarCardEditor);
