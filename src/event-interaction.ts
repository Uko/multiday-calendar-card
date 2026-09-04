export type EventActionName = 'none' | 'more-info';

/**
 * Event actions intentionally mirror Home Assistant's action-object shape so
 * hold_action and double_tap_action can be added without changing the schema.
 */
export type EventAction = {
  action: EventActionName;
};

export const DEFAULT_TAP_ACTION: EventAction = { action: 'none' };

export function validateTapAction(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'tap_action must be an action object.';
  }
  const action = (value as { action?: unknown }).action;
  if (action !== 'none' && action !== 'more-info') {
    return 'tap_action.action must be "none" or "more-info".';
  }
  return undefined;
}

export function normalizeTapAction(value: unknown): EventAction {
  const error = validateTapAction(value);
  if (error) throw new Error(error);
  return value === undefined ? { ...DEFAULT_TAP_ACTION } : { action: (value as EventAction).action };
}
