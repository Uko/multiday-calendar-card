# Multiday Calendar Card

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Uko&repository=multiday-calendar-card&category=Dashboard)

A Home Assistant Dashboard card that turns one or more `calendar.*` entities into a readable multi-day schedule. It shows day columns, a vertical time axis, duration-sized event blocks, all-day events, and overlapping events in one view.

It exists for dashboards and kiosks where a compact calendar list is not enough: see what is happening, when it happens, and where events overlap across the next few days without opening a separate calendar.

![Multiday Calendar Card showing the same two-day schedule in light and dark themes](docs/images/multiday-calendar-card-banner.png)

## Highlights

- Display one to seven days at a time.
- Combine multiple Home Assistant `calendar.*` entities.
- See timed events on a vertical time grid, sized and positioned by duration.
- Keep all-day events visible in compact rows above each day.
- Show an optional current-time line.
- Handle simultaneous events in adjacent lanes, with a `+N more` summary when the lane limit is exceeded.
- Use the visual card editor for everyday settings, or configure the card entirely in YAML.
- Choose an automatic timeline height or a fixed card height for dense dashboards and kiosks.

## Installation

### HACS

[![Open this repository in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Uko&repository=multiday-calendar-card&category=Dashboard)

1. Open the link above in a browser connected to your Home Assistant instance.
2. In HACS, download **Multiday Calendar Card**.
3. Reload the browser after installation if the card is not immediately available in the card picker.

Until the card is listed in the default HACS store, add this repository as a **Dashboard** custom repository in HACS:

```text
https://github.com/Uko/multiday-calendar-card
```

### Manual installation

1. Download `dist/multiday-calendar-card.js` from the release or repository.
2. Copy it to `<config>/www/multiday-calendar-card.js`.
3. Add it as a JavaScript module resource:

```yaml
url: /local/multiday-calendar-card.js
type: module
```

4. Reload the browser and add the card as a manual card.

## Quick start

```yaml
type: custom:multiday-calendar-card
title: Household schedule
days: 2
start_time: "06:00"
end_time: "22:00"
slot_minutes: 30
hour_height: 56
show_now_line: true
max_simultaneous_events: 3
calendars:
  - entity: calendar.household
    label: Household
    color: "#4caf50"
  - entity: calendar.personal
    label: Personal
    color: "#2196f3"
```

## Configuration

### Calendar sources

`calendars` is the list of calendars to display. Each entry requires an `entity` beginning with `calendar.`. `label` and `color` are optional display settings.

```yaml
calendars:
  - entity: calendar.household
    label: Household
    color: "#4caf50"
  - entity: calendar.work
    label: Work
    color: "#2196f3"
```

### Card options

| Option | Default | Description |
| --- | --- | --- |
| `title` | no title | Optional heading. Omit it for a titleless card. |
| `calendars` | `[]` | Calendar sources to show. Each source needs a `calendar.*` entity. See [Calendar sources](#calendar-sources). |
| `days` | `2` | Whole number of days to display, from `1` to `7`. |
| `start_time` | `"06:00"` | First visible time, in `HH:mm` format. |
| `end_time` | `"22:00"` | Last visible time, in `HH:mm` format. It must be after `start_time`; `"24:00"` is accepted as the end of the day. |
| `slot_minutes` | `30` | Grid interval. Allowed values are `15`, `20`, `30`, `60`, and `120`. |
| `show_now_line` | `true` | Show or hide the current-time line. |
| `max_simultaneous_events` | `3` | Positive whole-number lane cap for overlapping timed events. At `1`, only the first event is shown; at `2` or more, excess events are represented by `+N more`. |
| `hour_height` | `56` | Timeline height in pixels per visible hour. Used when `height` is omitted. |
| `height` | unset | Fixed outer-card height in pixels. It takes precedence over `hour_height` and compresses the timeline without hiding events. |
| `refresh_interval` | `30` | Minutes between calendar refreshes. It must be a positive number. |

### Layout examples

Use `hour_height` when the card may grow with the visible time range:

```yaml
type: custom:multiday-calendar-card
days: 3
start_time: "08:00"
end_time: "18:00"
hour_height: 64
calendars:
  - entity: calendar.household
```

Use `height` when the card must fit a kiosk or dashboard space. A fixed height overrides `hour_height`:

```yaml
type: custom:multiday-calendar-card
days: 2
start_time: "06:00"
end_time: "22:00"
height: 480
calendars:
  - entity: calendar.household
```

## Visual editor

The Home Assistant card editor exposes the common options in three groups:

- **Calendar sources** — calendar entities, display labels, and event colors.
- **View & schedule** — title, day count, visible hours, grid interval, current-time line, and overlap limit.
- **Layout & density** — automatic height with pixels per hour, or a fixed-height timeline.

Less-common operational settings, such as `refresh_interval`, remain available in YAML. The card refreshes calendar data every 30 minutes by default. If a calendar request fails, it performs up to two one-minute recovery retries before returning to the normal cadence.

## Notes and limitations

- The card is read-only: it displays events but does not create or edit them.
- Calendar sources must be Home Assistant `calendar.*` entities.
- The card uses the authenticated Home Assistant frontend API to read calendar events.
- If Home Assistant does not show an updated card after installation or upgrade, reload the browser and clear the browser cache if necessary.

## Development

```bash
npm install
npm run check
npm test
npm run build
```

The built HACS artifact is `dist/multiday-calendar-card.js`.
