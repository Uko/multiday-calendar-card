export type CalendarEditorConfig = {
  entity: string;
  color?: string;
  label?: string;
  [key: string]: unknown;
};

export type EditorConfig = {
  type: string;
  title?: string;
  days?: number;
  calendars?: CalendarEditorConfig[];
  start_hour?: number;
  end_hour?: number;
  slot_minutes?: number;
  height?: number | null;
  show_now_line?: boolean;
  max_simultaneous_events?: number;
  [key: string]: unknown;
};

export const GRID_INTERVALS = [15, 20, 30, 60, 120] as const;

export function normalizeEditorConfig(config: EditorConfig): EditorConfig {
  return {
    ...config,
    calendars: (config.calendars ?? []).map((calendar) => ({ ...calendar })),
  };
}

export function validateEditorConfig(config: EditorConfig): string[] {
  const errors: string[] = [];
  const calendars = config.calendars ?? [];

  if (calendars.length === 0) errors.push('Add at least one calendar source.');
  if (calendars.some((calendar) => !calendar.entity?.startsWith('calendar.'))) {
    errors.push('Every calendar source needs a calendar.* entity.');
  }

  if (config.days !== undefined && (!Number.isInteger(config.days) || config.days < 1 || config.days > 7)) {
    errors.push('Days displayed must be a whole number from 1 to 7.');
  }
  if (config.start_hour !== undefined && config.end_hour !== undefined && config.start_hour >= config.end_hour) {
    errors.push('Start hour must be before end hour.');
  }
  if (config.slot_minutes !== undefined && !GRID_INTERVALS.includes(config.slot_minutes as typeof GRID_INTERVALS[number])) {
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

export function editorWarnings(config: EditorConfig): string[] {
  const calendars = config.calendars ?? [];
  const labels = calendars.map((calendar) => calendar.label?.trim()).filter((label): label is string => Boolean(label));
  const colors = calendars.map((calendar) => calendar.color?.toLowerCase()).filter((color): color is string => Boolean(color));
  const warnings: string[] = [];

  for (const [values, property] of [[labels, 'label'], [colors, 'color']] as const) {
    const duplicate = values.find((value, index) => values.indexOf(value) !== index);
    if (duplicate) warnings.push(`Two or more calendar sources use the ${property} ${property === 'label' ? `“${duplicate}”` : duplicate}.`);
  }
  return warnings;
}
