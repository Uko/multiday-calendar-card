# multi-day-calendar-card

A Home Assistant custom Lovelace card for readable multi-day schedule views.

## Current state

The first functional slice is implemented:
- fetches configured `calendar.*` entities through the authenticated Home Assistant API
- renders timed events across 1–7 day columns
- clips events to the configured visible-hour range
- displays a now line and per-calendar labels/colors

All-day events and overlap lane packing are deliberately deferred to later iterations.

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
- all-day area
- overlap packing improvements
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

## Proposed Lovelace usage

```yaml
type: custom:multi-day-calendar-card
title: Calendar
days: 2
start_hour: 6
end_hour: 22
slot_minutes: 30
show_now_line: true
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
