# Activity System Redesign Plan

_Last updated: 2026-05-28_

## Purpose

This document captures the next-level activity system direction for Solara. The current app has moved activities onto the Dashboard, but activity creation, management, sharing, editing, and calendar behavior still need to become more intentional.

The core product correction is:

> An activity is not just a preset. An activity is a planning object: what the user wants to do, how long it takes, what UV/protection rules apply, what windows are preferred, and what time can be shared or scheduled.

## Main user feedback being addressed

### 1. Add activity and manage activities should be different

The Dashboard should have two separate actions:

- **+ Add Activity**
  - Fast creation flow.
  - Opens an Add Activity modal.
  - Can include presets and custom activity creation.
  - Focused on creating one or more new activities.

- **Manage**
  - Existing-activity management flow.
  - Opens a Manage Activities modal.
  - Shows saved activities only.
  - Allows edit, remove, duplicate, reorder later, and activity-level rule changes.
  - Should not primarily show the full preset catalog.

### 2. Activity flows should be modal-based

Activity management should not push the Dashboard down or change the full page layout.

Target modal surfaces:

- `AddActivityModal`
- `ManageActivitiesModal`
- `EditActivityModal`
- Later: `ShareActivityModal`

These should share a consistent modal shell with stable width, height, internal scrolling, and clear headers/footers.

### 3. Add activity needs a real flow

The current preset picker is too shallow. A better creation flow should eventually include:

1. Choose preset or custom activity.
2. Configure name/icon/duration.
3. Configure SPF/no-SPF assumption.
4. Configure preferred time rules.
5. Preview safe windows.
6. Save activity.

For the first implementation slice, keep the existing picker behavior but place it in a modal and separate it from Manage.

### 4. Manage activities should show existing activities only

Manage is not the preset catalog.

Manage should show:

- Saved activities.
- Duration.
- SPF assumption.
- Safe UV threshold label.
- Edit/remove controls.
- Later: duplicate/reorder/default rules.

Preset suggestions belong in Add Activity, not Manage Activities.

### 5. Activities should be editable where they appear

Users should be able to edit an activity from:

- Dashboard activity cards.
- Manage Activities modal.
- Calendar activity block/popover.

The same edit modal should eventually be reused across all entry points.

### 6. Show all safe windows, not just best window

The app currently emphasizes one `bestWindow`. In real use, a day may have multiple safe windows, commonly morning and evening.

Target output:

```ts
activityWindow = {
  bestWindow: { from: 7, to: 9 },
  allWindows: [
    { from: 6, to: 10, label: 'Morning' },
    { from: 16, to: 19, label: 'Evening' }
  ]
}
```

Dashboard and Calendar should eventually let users view/select a specific safe window.

### 7. Sharing should support activity-specific plans

There are three different share needs:

- **Share Solara page**
  - Generic app/page share.

- **Share schedule**
  - Broad daily UV/activity schedule share.

- **Share activity time**
  - Most important product flow.
  - Example: “Let’s do tennis today from 7:30–8:30 AM. Solara says this is the safest window.”

First version can use native share / copy text. Public share links can come later.

### 8. Calendar needs its own redesign pass

Calendar feedback:

- Calendar should be bigger.
- It should require less scrolling.
- It should only show active saved activities, never preset defaults.
- Clicking an activity block should allow edit/share/add-to-calendar.
- Users may need calendar window preferences or view modes.

Potential calendar views:

- All active activities.
- One activity.
- Best windows only.
- Full safe windows.
- Morning / Afternoon / Evening / Full day.

## Activity data model direction

Current activity model:

```ts
interface Activity {
  id: string
  name: string
  icon: string
  durationMins: number
  maxUV: number
  sunscreen: boolean
  custom?: boolean
}
```

Likely future model:

```ts
interface Activity {
  id: string
  name: string
  icon: string
  durationMins: number
  maxUV: number
  sunscreen: boolean
  custom?: boolean
  preferredHours?: {
    from: number
    to: number
  }
  preferredWindowType?: 'morning' | 'evening' | 'any'
  notes?: string
  locationLabel?: string
}
```

Do not add every future field immediately. Add only when the UI needs it.

## Implementation sequence

### PR 1 — Modal-based Add / Manage split

Goal: fix the interaction architecture without changing the data model too much.

Scope:

- Add separate `+ Add Activity` and `Manage` buttons in the Activity section.
- Add `AddActivityModal`.
- Add `ManageActivitiesModal`.
- Move preset/custom picker into Add modal.
- Manage modal shows saved activities only.
- Remove inline page expansion behavior.

Out of scope:

- Full edit modal.
- All safe windows.
- Activity sharing.
- Calendar redesign.
- Activity schema expansion.

### PR 2 — Edit individual activity

Scope:

- Add `EditActivityModal`.
- Edit from Activity card.
- Edit from Manage modal.
- Edit from Calendar popover.
- Update name/icon/duration/SPF/maxUV.

### PR 3 — All safe windows

Scope:

- Update window calculation to return `allWindows`.
- Activity cards show all safe windows.
- Calendar can render multiple windows per activity.

### PR 4 — Activity sharing

Scope:

- Share page.
- Share schedule.
- Share specific activity time.
- Start with native share/copy text.

### PR 5 — Calendar redesign

Scope:

- Bigger calendar.
- Less scrolling by default.
- Click activity block to edit/share/add.
- Active activities only.
- View mode options.

## Acceptance criteria for PR 1

- Activity section has separate `+ Add Activity` and `Manage` controls.
- `+ Add Activity` opens a modal.
- `Manage` opens a modal.
- Activity picker no longer expands inline on the Dashboard.
- Manage modal shows existing activities only.
- Add modal can still add preset and custom activities.
- Activity changes still persist through the existing preference save path.
- Guest/free/paid activity limits still apply.

## Product principle

The activity system should make the user feel like they are planning a real outdoor event, not toggling a static setting.
