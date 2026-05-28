# Solara UI/Product Redesign Plan

_Last updated: 2026-05-27_

## Purpose

This document captures the latest product/UI direction for Solara based on feedback after the first hardening + growth pass. This is a planning document only. It should guide the next implementation PRs, but it is not itself an implementation spec down to every prop or component.

The key theme: Solara should feel less like a settings-heavy dashboard and more like a daily outdoor planning tool. Core actions should move out of the Preferences modal and into the main product surface.

## Executive summary

The current UI has the right core mechanics, but the product hierarchy is off:

- Too many primary actions live inside Preferences.
- Activity creation is hidden behind Settings/Preferences.
- Sunscreen is currently modeled globally, but the desired product behavior is activity-specific.
- The day selector exposes too much future forecast surface to anonymous/free users.
- Facts/tips are useful but placed too low and too wide.
- Text density is too small overall.
- The dashboard needs more visual personality, especially around the sun/UV timeline.
- Account, plan, location, appearance, and activity editing need clearer ownership.

This implies a structural redesign, not just small CSS tweaks.

## User feedback, point by point

### 1. Move carousel facts to the top

**User direction:** The fact carousel should be at the top. It should not be as wide. It should use slightly larger text.

**Current state:** `TipCarousel` is rendered at the bottom of `Dashboard`, after the metrics, UV timeline, and activity cards.

**Product interpretation:** The tips are educational context and should prime the user before they interpret UV and activity windows. Right now they feel like footer content and are easy to ignore.

**Proposed direction:**

- Move `TipCarousel` near the top of Dashboard, likely directly under the day/today selector or above the metrics grid.
- Constrain its width so it reads like a helpful insight card, not a full-width banner.
- Increase body text size from roughly 13px to 14–15px.
- Increase title size/weight slightly.
- Consider showing one concise “daily fact” rather than a constantly rotating block if the top area gets crowded.

**Implications:**

- Dashboard vertical hierarchy changes: tips become part of first-screen content.
- Top-of-page real estate becomes more valuable, especially on mobile.
- A narrower tip card may require layout rules: centered max-width on desktop, full-width on small mobile.

**Open question:** Should tips rotate automatically at all, or should they become dismissible/static “today’s sun note” content?

---

### 2. Increase text size globally

**User direction:** Overall, text should be larger.

**Current state:** The app uses many 11–13px labels, metric captions, and card text. This creates a polished but slightly cramped feel.

**Product interpretation:** Solara is a daily utility and should be readable at a glance outdoors, on a phone, possibly in sunlight. Small UI text works against the product’s context.

**Proposed direction:**

- Establish a clearer type scale:
  - Micro labels: 12px minimum.
  - Body text: 15px.
  - Card titles: 16px.
  - Primary metric labels: 13–14px.
  - Primary metric values: 30–34px.
- Avoid 10–11px except for tiny decorative metadata.
- Use fewer dense rows inside cards.
- Prefer progressive disclosure over shrinking text.

**Implications:**

- Cards will become taller.
- Some grids may need fewer columns on mobile.
- The Preferences modal needs re-layout to avoid becoming more cramped.
- Calendar blocks cannot simply increase text without also changing their layout/filtering model.

---

### 3. Change day-access gating by tier

**User direction:**

- Anonymous/free view should show only Today.
- To see Tomorrow, user must create an account.
- Signed-in/free users can see Tomorrow.
- Premium users can see 10 days out.

**Current state:** The current day selector displays the forecast array and visually locks days index `>= 2` for non-paid users, but anonymous users can still see Today and Tomorrow.

**Desired model:**

| Tier | Forecast access |
| --- | --- |
| Anonymous / guest | Today only |
| Free signed-in account | Today + Tomorrow |
| Pro | 10 days |

**Product interpretation:** Future forecast access becomes an account-creation and monetization lever. This is stronger than the current model and makes signup value clearer.

**Proposed direction:**

- Update tier limits so anonymous `futureDays = 1`, free `futureDays = 2`, paid `futureDays = 10`.
- Render only accessible day pills.
- Add an upsell affordance after the accessible range:
  - Anonymous: “Sign in to see tomorrow.”
  - Free: “Go Pro for 10-day planning.”
- Calendar view should follow the same rules.
- Share text should respect the selected/access-limited day.

**Implications:**

- This changes the onboarding funnel: account creation becomes tied to future planning.
- Calendar view becomes less valuable for anonymous users unless it clearly invites sign-in.
- Weather fetching can still fetch 10 days internally, but UI should not expose inaccessible days.
- If the app keeps fetching all days for all tiers, that is simpler technically but not a strict paywall. If strictness matters, fetch depth should follow tier.

**Implementation note:** Prefer rendering constraints first. Later, if cost/abuse becomes meaningful, adjust forecast fetch depth by tier.

---

### 4. Add a visual sun arc / sun movement indication

**User direction:** Add an indication of the sun moving across the earth. The user wants to see the sun arcing across the screen a bit in the background, especially connected to “UV by hour.”

**Current state:** UV by hour is a bar timeline. It is useful but not emotionally or visually distinctive.

**Product interpretation:** This is not just decoration. A sun arc can make Solara feel like a sun-planning product rather than a generic data dashboard. It can also help users intuit morning/peak/evening.

**Possible designs:**

1. **Simple background arc behind UV timeline**
   - Draw an SVG arc from left to right.
   - Place a sun icon/dot at the current hour or selected hour.
   - Keep it subtle behind the bars.
   - Lowest complexity.

2. **Static day arc card above timeline**
   - Show sunrise-ish left, noon peak center, evening right.
   - Use current time to position sun.
   - UV peak shown as a highlighted point.
   - More readable and less likely to fight with chart bars.

3. **Interactive scrubber**
   - User drags/taps along the sun arc to inspect hourly UV.
   - Highest value but more complex.

**Recommended V1 direction:** Start with option 2: a static “Sun path” card that sits above or inside the UV section. It should show:

- Morning → midday → evening arc.
- Current sun position for Today.
- Peak UV marker.
- Low visual opacity so it enhances rather than overwhelms.

**Implications:**

- Requires a new component, likely `SunArc.tsx`.
- Needs to work for future days where there is no “current sun” marker; use peak marker only.
- Should respect reduced-motion. User explicitly said not necessarily animation, just indication.
- This can become a brand-defining visual if done well.

---

### 5. Move activity creation out of Settings/Preferences

**User direction:** Activities should be managed from the activity section on the main page. Activity creation should not be hidden in Settings.

**Current state:** Dashboard empty state has “+ Add activities,” but it opens Preferences to the Activities tab. `PreferencesModal` includes `ActivityManager`, which allows selecting and creating activities.

**Product interpretation:** Activities are core product content, not configuration. They should be treated like the user’s plan/workspace, not buried beside account/location settings.

**Proposed direction:**

- Move `ActivityManager` or a redesigned version of it into the main Dashboard activity section.
- The Activity section should have:
  - Current activity cards/windows.
  - Add activity button.
  - Preset activity picker.
  - Custom activity creation.
  - Activity-specific settings, including sunscreen assumption.
- Preferences should no longer be the primary place to add activities.

**Implications:**

- Dashboard needs local edit state or direct preference-save behavior.
- The current `onAddActivities` flow should be replaced with inline activity management.
- Activity add/edit interactions need to be compact so the main page does not become chaotic.
- This likely requires extracting activity add/edit UI into a reusable component independent of Preferences.

**Recommended UX:**

- Activity section header: “Activities” + “Add activity” button.
- Click opens an inline drawer/card, not global Preferences.
- Activity cards have small “Edit” affordance for per-activity settings.
- If no activities, empty state stays in the main page and opens the inline add flow.

---

### 6. Pull everything possible out of Settings

**User direction:** “This idea that everything is in the settings button, I want to pull everything out of the settings button.”

**Current state:** Preferences owns skin type, sunscreen, activities, location, account, plan/waitlist, and appearance.

**Product interpretation:** Preferences has become a dumping ground. The product needs a clearer information architecture.

**Proposed new ownership model:**

| Concern | Where it should live |
| --- | --- |
| Activities | Main Dashboard Activity section |
| Activity creation | Main Dashboard Activity section |
| Activity sunscreen | Per-activity edit UI |
| Location | Header location control and/or Settings > Location |
| Skin type | Settings > Sun profile |
| Dark mode | Settings > Appearance |
| Account | Account/Plan area, possibly separate from Settings |
| Pro/plan badge | Header right side / account area |
| Hidden suggestions/presets | Settings > Activity preferences or inline Activity manager |

**Implications:**

- Preferences should become Settings, not a generic modal for every action.
- Main page becomes more interactive.
- Need to decide whether Account is inside Settings or separate.
- Header may need two distinct buttons: Settings and Account/Plan.

---

### 7. Move Pro badge/plan to the right side of the header

**User direction:** Pro should be on the right side of the top bar.

**Current state:** The tier badge sits near the logo/location group on the left side of the header.

**Product interpretation:** Plan state belongs with account/actions, not brand/location. Left side should be identity/context; right side should be controls/account/plan.

**Proposed direction:**

- Header left: logo + location.
- Header right: UV alert, plan badge, settings, account/sign-in.
- On mobile, collapse plan/account into a compact pill or menu.

**Implications:**

- Header layout needs a small redesign.
- This pairs naturally with moving settings/account responsibilities apart.

---

### 8. Keep dark mode inside Settings

**User direction:** Dark mode should be in Settings.

**Current state:** Dark mode is already inside Preferences > General.

**Product interpretation:** This is directionally right, but the Settings IA should make it clearer. Dark mode should not compete with skin type or sunscreen as a core sun-profile setting.

**Proposed direction:**

- Create Settings tabs or sections:
  - Sun profile
  - Appearance
  - Location
  - Account/Plan, if account is not separate
- Place dark mode in Appearance.

**Implications:**

- Requires Settings modal reorganization.
- Appearance can stay simple for now.

---

### 9. Make Settings modal size stable

**User direction:** The settings box should not change size between Location, Account, Settings, etc. It should be the same modal size.

**Current state:** The modal has fixed max-width and max-height, but content density and section height make it feel unstable, especially across tabs.

**Product interpretation:** Users need orientation. If tab content changes the visual weight too much, the modal feels janky.

**Proposed direction:**

- Use a fixed modal shell size, e.g. max-width 560–640px and fixed min-height/height based on viewport.
- Header and footer remain fixed.
- Content area scrolls internally.
- Tabs/sections do not resize the shell.

**Implications:**

- Must design for overflow intentionally.
- Larger text means more scrolling inside Settings.
- The modal should probably get wider than current 480px on desktop.

---

### 10. Skin type takes up too much space

**User direction:** Skin type preference is too long and takes up too much space.

**Current state:** Skin type displays five full-width rows with burn-time descriptions.

**Product interpretation:** Skin type is important but should not dominate Settings. The current UI treats it like onboarding every time.

**Proposed direction:**

- In Settings, show skin type as a compact selector:
  - Dropdown, segmented control, or collapsed accordion.
- Keep detailed explanations in onboarding or an expandable “How this works” section.
- Show current selected skin type prominently but compactly.

**Implications:**

- Less educational content in Settings by default.
- Need to preserve user trust by making explanations available on demand.

---

### 11. Collapse/hide suggestions and activity presets

**User direction:** We should be able to collapse different suggestions and hide suggestions in activity settings. Activity settings can show hidden suggestions or pre-activities, but not be the main activity creation place.

**Current state:** Preset activity categories are always shown inside `ActivityManager` when adding activities.

**Product interpretation:** Presets are useful, but they can become clutter. Users need control over the suggestion surface.

**Proposed direction:**

- Add activity suggestion preferences:
  - Hide a preset activity suggestion.
  - Restore hidden suggestions.
  - Possibly collapse preset categories.
- Store hidden preset IDs in preferences, e.g. `hiddenActivitySuggestionIds: string[]`.
- Main activity add flow should respect hidden suggestions.
- Settings > Activity preferences can manage hidden suggestions and category visibility.

**Implications:**

- Requires preference schema update/migration.
- Activity manager needs to distinguish between selected activities and suggestion visibility.
- This supports a cleaner main page long term.

---

### 12. Remove global sunscreen preference; make sunscreen per-activity

**User direction:** Do not record “no sunscreen” as a global preference. Sunscreen should be directly related to the activity.

**Current state:** `UserPreferences` has a global `sunscreen` field, and `Activity` also has `sunscreen`. Recent code applies the global sunscreen choice across all selected activities.

**Product interpretation:** The user is right. Sunscreen is situational: running, swimming, gardening, and a quick coffee walk may have different assumptions. A global sunscreen switch oversimplifies behavior and creates inaccurate recommendations.

**Proposed direction:**

- Make `activity.sunscreen` the source of truth.
- Deprecate `UserPreferences.sunscreen`.
- Keep global field only for backward compatibility during migration, then stop exposing it in UI.
- In activity add/edit flow, ask sunscreen assumption per activity:
  - “No sunscreen”
  - “SPF 30+”
  - Later: “shade/hat/clothing” as additional protection modifiers.

**Implications:**

- Preference migration must change: global sunscreen can initialize missing activity sunscreen, but new UI should not set all activities globally.
- Dashboard copy should talk about each activity’s assumption.
- Activity cards already have enough room to show “SPF assumed” per card.
- Notifications should use per-activity sunscreen only.

**Recommended migration:**

- Keep `UserPreferences.sunscreen?: boolean` as deprecated.
- When loading old data, if an activity lacks `sunscreen`, use old global value.
- When saving new data, stop writing global sunscreen or leave it unchanged only for legacy compatibility.

---

## Architectural implications

### A. PreferencesModal should shrink in responsibility

Preferences/Settings should no longer own all major product actions. Its role should become:

- Sun profile: skin type and explanatory copy.
- Appearance: dark/light mode.
- Location: current/search location, unless location remains only in header.
- Account/Plan: sign in/out, Pro waitlist/upgrade.
- Activity preferences: hidden suggestions, category visibility, maybe defaults.

It should not own:

- Creating activities.
- Selecting primary activities.
- Editing routine-specific activity details, except possibly advanced defaults.

### B. Activity domain needs richer state

The activity model probably needs to expand from:

```ts
Activity {
  id
  name
  icon
  durationMins
  maxUV
  sunscreen
  custom?
}
```

Toward:

```ts
Activity {
  id
  name
  icon
  durationMins
  maxUV
  sunscreen
  custom?
  hidden?
  notes?
}

UserPreferences {
  hiddenActivitySuggestionIds?: string[]
  collapsedActivityCategories?: string[]
  sunscreen?: boolean // deprecated legacy only
}
```

Do not overbuild this yet. The immediate need is per-activity sunscreen and hidden suggestions.

### C. Dashboard becomes the core workspace

The Dashboard should no longer just display computed output. It should let the user shape the plan directly:

- Add activity.
- Edit activity duration.
- Edit sunscreen assumption.
- Remove activity.
- Possibly reorder activities.
- See safe windows immediately update.

This moves Solara closer to a daily planning app and away from a settings-first dashboard.

### D. Tier gating becomes part of navigation

Forecast access is now a core monetization/sign-up behavior. It should be visible and understandable:

- Anonymous users see Today and a “Sign in for Tomorrow” affordance.
- Free users see Today/Tomorrow and a “Go Pro for 10 days” affordance.
- Pro users see 10 days.

This affects Dashboard, Calendar, and possibly notification messaging.

### E. Visual identity should move beyond cards and metrics

The sun arc idea is a strong product identity cue. It should be treated as a product feature, not just decoration.

Potential future language:

- “Follow the sun across your day.”
- “Your safest window is before the UV peak.”
- “Plan around the sun, not just the clock.”

## Proposed next PR sequence

### PR 1 — Dashboard hierarchy + tier day gating

**Goal:** Make the main screen reflect the desired product hierarchy without touching every settings concern yet.

Scope:

- Move `TipCarousel` to top of Dashboard.
- Constrain tip card width and increase typography.
- Increase major text sizes across Dashboard.
- Change day selector access:
  - Guest: Today only.
  - Free: Today + Tomorrow.
  - Pro: 10 days.
- Add locked CTA pill after accessible days.
- Ensure Calendar respects same forecast access rules.

Why first:

- This fixes visible product behavior immediately.
- It clarifies the sign-up/pro value ladder.
- It is relatively contained.

### PR 2 — Activity creation on main page

**Goal:** Move activity creation out of Settings and into the Activity section.

Scope:

- Extract activity add/select/create UI from `ActivityManager` into a dashboard-friendly component.
- Add an inline Activity drawer/card in the Activity section.
- Empty state opens inline add flow, not Preferences.
- Activity cards get edit controls for duration and sunscreen assumption.
- Preferences no longer shows activity selection/creation.

Why second:

- This is the biggest IA shift.
- It changes how users interact with the core product.

### PR 3 — Per-activity sunscreen model

**Goal:** Remove global sunscreen from the visible product model.

Scope:

- Deprecate global sunscreen UI.
- Keep global field for migration only.
- Add per-activity sunscreen controls in activity add/edit flow.
- Update copy throughout Dashboard/Calendar/Notifications.
- Update migrations to initialize missing activity sunscreen from legacy global value.

Why third:

- This pairs naturally with activity editing.
- It avoids inaccurate global assumptions.

### PR 4 — Settings modal redesign

**Goal:** Turn Preferences into a stable, smaller-responsibility Settings modal.

Scope:

- Rename Preferences to Settings in UI.
- Fixed modal shell size.
- Internal scroll area.
- Compact skin type selector.
- Appearance section for dark mode.
- Location section.
- Account/Plan section or separate Account menu.
- Activity preferences section only for hidden suggestions/defaults.

Why fourth:

- Once activities move out, Settings becomes easier to simplify.

### PR 5 — Sun arc visual

**Goal:** Add a branded sun-path visual around UV by hour.

Scope:

- Add `SunArc` component.
- Show current sun position for Today.
- Show peak UV marker.
- Keep motion minimal or none.
- Respect reduced-motion.
- Use it above or behind the UV by hour card.

Why fifth:

- It adds delight and product identity after hierarchy is fixed.
- It should not block IA/product correctness.

### PR 6 — Hidden/collapsible activity suggestions

**Goal:** Let users control preset clutter.

Scope:

- Add hidden suggestion IDs to preferences.
- Let users hide preset suggestions.
- Add Settings > Activity preferences for restore/manage hidden suggestions.
- Add collapsible categories if still needed.

Why sixth:

- Useful, but lower priority than moving activity creation to the main page.

## Recommended information architecture

### Header

Left:

- Solara logo/name.
- Location selector.

Right:

- Compact UV alert.
- Plan badge / Pro pill.
- Settings button.
- Account/sign-in button or avatar.

### Dashboard top

- Day selector with tier-appropriate access.
- Top fact/tip card, narrower and larger text.
- Optional locked forecast CTA.

### Main dashboard body

- Metrics grid with larger typography.
- Sun arc / UV by hour visual.
- Activities workspace:
  - Existing activity cards.
  - Add activity inline.
  - Edit activity inline.
  - Per-activity sunscreen/duration.

### Settings

- Sun profile: compact skin type.
- Appearance: dark mode.
- Location: location management if not fully handled in header.
- Account/Plan: sign-in, waitlist, Pro.
- Activity preferences: hidden suggestions, defaults, maybe category visibility.

## Product rationale

This direction makes Solara more intuitive because it matches user intent:

- “I want to plan today” lives on the Dashboard.
- “I want to add what I do outside” lives in Activities.
- “I want to change my app/profile settings” lives in Settings.
- “I want future planning” is tied to account/pro value.
- “I want to understand the day visually” is supported by the sun arc.

The previous structure was technically convenient but product-confusing: Settings became the place for everything. The next version should make the main page the active planning surface.

## Decisions made from this feedback

1. Activity creation belongs on the main Dashboard.
2. Settings should not be the primary activity creation surface.
3. Sunscreen should be per-activity, not global.
4. Guest forecast access should be Today only.
5. Free account forecast access should include Tomorrow.
6. Pro forecast access should be 10 days.
7. Tips/facts should move upward and become more readable.
8. Text size should increase globally.
9. Settings should have a stable modal shell.
10. The sun arc visual is worth exploring as a product identity feature.

## Open questions before implementation

1. Should Account be a separate modal/menu from Settings, or a tab inside Settings?
2. Should the fact carousel auto-rotate at the top, or become a single daily static fact?
3. Should the sun arc live inside the UV card or as its own card above UV by hour?
4. Should anonymous users be allowed to add local activities, or should activity creation require sign-in? Current behavior effectively encourages account creation for activities.
5. Should Pro upgrade remain a waitlist, or should the product start wiring Stripe soon?
6. Should hidden activity suggestions sync across devices, or stay local until account sign-in?

## Non-goals for the next immediate PR

- Do not implement a full animation-heavy sun simulation.
- Do not overhaul the entire app in one PR.
- Do not remove legacy preference fields without migration.
- Do not add Stripe until pricing is decided.
- Do not add advanced sun exposure modeling yet.

## Suggested immediate next step

Start with PR 1: Dashboard hierarchy + tier day gating.

This gives the biggest visible improvement with the lowest architectural risk. After that, move activity creation into the main Activity section and redesign Settings around the reduced responsibility model.
