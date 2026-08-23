import {
  GRID_INTERVALS,
  editorWarnings,
  normalizeEditorConfig,
  validateEditorConfig,
  type CalendarEditorConfig,
  type EditorConfig,
} from './editor-model';

type HomeAssistantLike = {
  states?: Record<string, unknown>;
};

type EntityPicker = HTMLElement & {
  hass?: HomeAssistantLike;
  value?: string;
  includeDomains?: string[];
};

const CARD_TYPE = 'custom:multiday-calendar-card';

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
    this.querySelectorAll<EntityPicker>('ha-entity-picker').forEach((picker) => {
      picker.hass = this._hass;
      picker.includeDomains = ['calendar'];
      picker.value = picker.getAttribute('value') ?? '';
    });
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
    const startHour = config.start_hour ?? 6;
    const endHour = config.end_hour ?? 22;
    this.innerHTML = `
      <style>
        :host { display: block; }
        .section { border-top: 1px solid var(--divider-color); padding: 12px 0; }
        .section:first-child { border-top: 0; padding-top: 0; }
        h3 { margin: 0 0 10px; font-size: 1rem; }
        .field, .calendar-row { display: grid; gap: 6px; margin: 8px 0; }
        .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .calendar-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 96px auto; align-items: end; padding: 10px; border: 1px solid var(--divider-color); border-radius: 8px; }
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
        @media (max-width: 600px) { .grid, .calendar-row { grid-template-columns: 1fr; } }
      </style>
      <section class="section">
        <h3>Calendar sources</h3>
        <div class="calendar-list">${calendars.map((calendar, index) => `
          <div class="calendar-row" data-calendar-index="${index}">
            <div class="field"><label>Calendar entity</label><ha-entity-picker data-field="entity" value="${escapeHtml(calendar.entity ?? '')}"></ha-entity-picker></div>
            <div class="field"><label>Display label (optional)</label><input data-field="label" value="${escapeHtml(calendar.label ?? '')}" placeholder="Calendar name"></div>
            <div class="field"><label>Event color</label><input data-field="color" value="${escapeHtml(calendar.color ?? '')}" placeholder="#4caf50" pattern="^#[0-9a-fA-F]{6}$"></div>
            <button class="remove" data-action="remove-calendar" type="button" aria-label="Remove calendar source">Remove</button>
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
          <div class="field"><label>Visible start hour</label><select data-config="start_hour">${Array.from({ length: 24 }, (_, hour) => `<option value="${hour}" ${startHour === hour ? 'selected' : ''}>${String(hour).padStart(2, '0')}:00</option>`).join('')}</select></div>
          <div class="field"><label>Visible end hour</label><select data-config="end_hour">${Array.from({ length: 24 }, (_, hour) => hour + 1).map((hour) => `<option value="${hour}" ${endHour === hour ? 'selected' : ''}>${String(hour).padStart(2, '0')}:00</option>`).join('')}</select></div>
        </div>
        <label class="toggle"><input data-config="show_now_line" type="checkbox" ${config.show_now_line !== false ? 'checked' : ''}> Show current-time line</label>
      </section>
      <section class="section">
        <h3>Layout & density</h3>
        <label class="toggle"><input type="checkbox" data-action="fixed-height" ${fixedHeight ? 'checked' : ''}> Use a fixed card height</label>
        <div class="field fixed-height-field" ${fixedHeight ? '' : 'hidden'}><label>Fixed height (pixels)</label><input data-config="height" type="number" min="1" step="1" value="${fixedHeight ? config.height : ''}"><div class="hint">A fixed height compresses the timeline; it does not hide events.</div></div>
        <div class="field"><label>Maximum simultaneous timed events</label><input data-config="max_simultaneous_events" type="number" min="1" step="1" value="${config.max_simultaneous_events ?? 3}"><div class="hint">At 1, only the first overlapping event is shown. At 2 or more, the final lane summarizes any excess as “+N more”.</div></div>
      </section>
      <div class="validation" role="alert"></div>
    `;
    this.bindEvents();
    this.assignHassToEntityPickers();
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
    this.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-config]').forEach((field) => field.addEventListener('change', () => {
      const key = field.dataset.config as keyof EditorConfig;
      const value = field.type === 'checkbox' ? (field as HTMLInputElement).checked :
        field.type === 'number' ? numberValue(field.value) : field.value;
      this.updateConfig({ [key]: value });
    }));
    this.querySelectorAll<HTMLElement>('[data-calendar-index]').forEach((row) => {
      const index = Number(row.dataset.calendarIndex);
      row.querySelector<EntityPicker>('ha-entity-picker')?.addEventListener('value-changed', (event) => {
        this.setCalendar(index, { entity: (event as CustomEvent<{ value: string }>).detail.value ?? '' });
      });
      row.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((field) => field.addEventListener('change', () => {
        this.setCalendar(index, { [field.dataset.field!]: field.value.trim() || undefined });
      }));
    });
  }
}

customElements.define('multiday-calendar-card-editor', MultidayCalendarCardEditor);
