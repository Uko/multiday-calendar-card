# multiday-calendar-card

A Home Assistant custom Lovelace card for readable multi-day schedule views.

## Current state

The first functional slice is implemented:
- fetches configured `calendar.*` entities through the authenticated Home Assistant API
- renders timed events across 1–7 day columns
- renders all-day events as compact single-line bars beneath each day name
- recalculates the shared day-header height, preserving aligned time labels and shrinking the fixed-height timeline grid when required
- clips events to the configured visible-hour range
- displays a now line and per-calendar labels/colors
- packs overlapping timed events into adjacent lanes, with a configurable cap and summary event for overflow

## Intended product direction

The card is meant to solve a scheduler-style use case that existing planner cards do not cover well:
- multiple day columns
- vertical time axis
- event blocks sized by duration
- visual overlap handling
- kiosk-friendly readability

## Planned feature scope

### Phase 1
- read-only card
- 1-day and 2-day views
- configurable visible hour range
- configurable slot interval
- Home Assistant `calendar.*` entity support
- now line
- event duration + placement rendering

### Later
- multiple calendars with color mapping
- responsive kiosk tuning
- optional richer labels/location display

## Development

### Install

```bash
npm install
```

### Type-check

```bash
npm run check
```

### Build

```bash
npm run build
```

## Visual configuration editor

Home Assistant's card editor exposes the everyday configuration in three sections:

- **Calendar sources:** add and remove `calendar.*` entities, optional display labels, and optional event colors. Sources are allowed to share labels or colors; the editor gives a non-blocking warning to make that choice visible.
- **View & schedule:** title (or no title), 1–7 days, visible whole-hour range, current-time line, and a 15, 20, 30, 60 minute, or **2 hour** grid interval.
- **Layout & density:** automatic or fixed pixel height and the maximum simultaneous timed-event lanes.

The editor deliberately leaves operational and less-common behavior—such as `refresh_interval`—to YAML for now. Existing and future YAML keys are retained when the editor is opened and saved.

## Proposed Lovelace usage

```yaml
type: custom:multiday-calendar-card
title: Calendar
days: 2
start_hour: 6
end_hour: 22
slot_minutes: 30
# Optional fixed outer-card height in pixels. Omit to retain auto sizing.
height: 480
show_now_line: true
# Maximum parallel timed-event lanes in each overlapping group (default: 3).
# At a cap above 1, excess events become a colored "+N more" summary bubble.
# At 1, only the first event in an overlap group is shown.
max_simultaneous_events: 3
calendars:
  - entity: calendar.example_household
    label: Household
    color: "#4caf50"
  - entity: calendar.example_personal
    label: Personal
    color: "#2196f3"
```

## Repo notes

This repo was bootstrapped to support local iteration first and eventual publication later.
