# Solara UI Redesign Feedback Coverage Audit

_Last updated: 2026-05-27_

## Purpose

This document rereads the original feedback and checks whether `docs/UI_PRODUCT_REDESIGN_PLAN.md` captured every point. It also records the nuances that should be treated as hard product direction, not optional polish.

## Overall audit result

The first planning doc covered the majority of the feedback, but a few points need to be stated more sharply:

1. Settings should not just be reorganized; it should stop being the place where primary product work happens.
2. Activity creation should be removed from Settings entirely.
3. Activity settings may still exist, but only for editing/configuration, hidden suggestions, defaults, or advanced activity preferences.
4. Sunscreen should not be a global preference in the active product model.
5. The modal issue is not only that Settings changes height; the broader point is that Location, Account, and Settings surfaces should feel equally stable and intentionally sized.
6. The sun arc should be treated as a feasible visual layer, but implemented modestly first.

## Exact feedback coverage

### 1. Carousel facts should be at the top

**Original feedback:** “The carousel facts should be at the top.”

**Covered in prior doc:** Yes.

**Where:** `UI_PRODUCT_REDESIGN_PLAN.md` section 1 and PR 1.

**Planning implication:** Move facts/tips into the first screen of Dashboard, likely under the day selector and above the metric grid.

**Priority:** High. This is a visible hierarchy fix.

---

### 2. Carousel should not be as wide

**Original feedback:** “It shouldn’t be as wide.”

**Covered in prior doc:** Yes.

**Where:** Section 1 mentions constrained width.

**Planning implication:** Tip card should become a centered/narrower insight card on desktop, not a full-width banner. On mobile it can still fill width.

**Priority:** High.

---

### 3. Carousel text should be larger

**Original feedback:** “It should be a little bit larger text.”

**Covered in prior doc:** Yes.

**Where:** Section 1.

**Planning implication:** Increase tip body text to roughly 14–15px and title to around 15–16px.

**Priority:** High.

---

### 4. Overall text should be larger

**Original feedback:** “Overall, I feel like we should have larger text.”

**Covered in prior doc:** Yes.

**Where:** Section 2.

**Planning implication:** This is a broad UI pass, not only carousel styling. Dashboard labels, cards, activity rows, buttons, and modal content should all stop relying on 10–12px text as much.

**Priority:** High.

---

### 5. Anonymous/free view should only show Today

**Original feedback:** “On the top where it has all the different days, it should just show us on the free view, it should just show us today.”

**Covered in prior doc:** Mostly yes, with one wording nuance.

**Nuance:** The phrase “free view” here appears to mean the not-signed-in/default view. The intended model is:

- Guest/default/free view: Today only.
- Create a free account: unlock Tomorrow.
- Premium: unlock 10 days.

**Planning implication:** Avoid ambiguous naming in UI. Use “Guest” or “Not signed in” internally, and “Free account” for signed-in free users.

**Priority:** High.

---

### 6. Tomorrow requires account signup

**Original feedback:** “If we want to see future views, we could sign up for an account. If you want to be able to see tomorrow, you have to make an account. If you make an account, you can see tomorrow.”

**Covered in prior doc:** Yes.

**Where:** Section 3 and PR 1.

**Planning implication:** The locked day CTA for guests should be account-focused, not Pro-focused. Suggested copy: “Sign in to see tomorrow.”

**Priority:** High.

---

### 7. Ten days requires premium

**Original feedback:** “If you want to be able to see 10 days out, you have to get a premium account.”

**Covered in prior doc:** Yes.

**Where:** Section 3.

**Planning implication:** Free signed-in users see Today + Tomorrow, then a Pro CTA for 10-day planning.

**Priority:** High.

---

### 8. Add sun movement / sun arc indication

**Original feedback:** “I’d like there to be an animation. Not an animation, but like an indication of like the sun. And, you know, like we can see the UV by hour. I would like there to be like the sun is moving across the earth, you know. I want to be able to see a sun that’s arcing across the screen a little bit in the background.”

**Covered in prior doc:** Yes.

**Where:** Section 4 and PR 5.

**Nuance:** The feedback is not demanding a complicated animation. It asks for an indication of movement/arc. The correct first implementation is a subtle visual affordance, not a heavy simulation.

**Planning implication:** Build a lightweight `SunArc` component:

- SVG arc.
- Sun dot positioned by current hour for Today.
- Peak UV marker.
- Subtle background/overlay near the UV chart.
- No complex animation by default.

**Priority:** Medium-high. Important for product identity, but should follow hierarchy and activity IA work.

---

### 9. User asked for feasibility judgement on sun arc

**Original feedback:** “That may just be a little bit too advanced, but I don’t know. Let me know what you think you could do.”

**Covered in prior doc:** Mostly yes.

**Extra answer:** It is not too advanced if scoped correctly. The feasible first version is a static SVG arc with current-position and peak markers. The too-advanced version would be an interactive/animated solar simulation.

**Planning implication:** Treat static `SunArc` as achievable in one contained PR.

**Priority:** Medium-high.

---

### 10. Add activities from the activity section

**Original feedback:** “We should be able to add activities from the activity section.”

**Covered in prior doc:** Yes.

**Where:** Section 5 and PR 2.

**Planning implication:** The Activity section becomes a workspace with Add/Edit controls. The empty state should open inline add UI, not Preferences.

**Priority:** Very high.

---

### 11. Pull everything possible out of Settings

**Original feedback:** “This idea that everything is in the settings button, I want to pull everything out of the settings button.”

**Covered in prior doc:** Yes, but should be emphasized more strongly.

**Correction:** This is not just “make Settings cleaner.” It is a product architecture direction: primary product actions should live on the main page.

**Planning implication:** Settings is for secondary configuration. Dashboard is for planning. Activities is for activity creation/editing.

**Priority:** Very high.

---

### 12. Activities should be in the activity section

**Original feedback:** “Activities should be in the activity section.”

**Covered in prior doc:** Yes.

**Planning implication:** Activity list, safe windows, add activity, edit activity, and per-activity sunscreen should live together.

**Priority:** Very high.

---

### 13. Activity creation should not be in Settings

**Original feedback:** “Activity creation should be done on the main page. It should not be available in the settings button.”

**Covered in prior doc:** Yes, but this should be treated as a hard rule.

**Hard rule:** Settings must not contain the primary activity picker/create flow.

**Planning implication:** Remove `ActivityManager` from Settings/Preferences. If a Settings > Activity Preferences section exists, it should only manage defaults, hidden suggestions, collapsed categories, or advanced preferences.

**Priority:** Very high.

---

### 14. Activity creation should not be parallel with Account and Location edits

**Original feedback:** “It should not be on parallel with account and location edits.”

**Covered in prior doc:** Partially.

**Missed nuance:** The prior doc said Preferences should no longer be primary activity creation, but did not state this exact information-architecture rule strongly enough.

**Corrected interpretation:** Activities are not the same category of task as Account, Location, Appearance, or Sun Profile. Activities are product content. Account/location/settings are configuration.

**Planning implication:** Remove the current Settings tab structure where Activities sits beside General, Location, and Account.

**Priority:** Very high.

---

### 15. Pro badge should be on the right side of the top bar

**Original feedback:** “The pro that’s on the bar should be on the right.”

**Covered in prior doc:** Yes.

**Where:** Section 7 and IA section.

**Planning implication:** Header left should be logo/location. Header right should contain UV alert, plan badge, settings, sign-in/account.

**Priority:** Medium-high.

---

### 16. Dark mode should be in Settings

**Original feedback:** “The dark mode should be in settings.”

**Covered in prior doc:** Yes.

**Nuance:** Dark mode can stay in Settings, but should live under Appearance, not in a crowded General/Profile area.

**Priority:** Medium.

---

### 17. There should be a separate Settings thing

**Original feedback:** “So there should be a separate settings thing.”

**Covered in prior doc:** Partially.

**Clarification:** Settings should become its own clearly scoped surface, separate from the activity creation flow. Account may either be part of this same modal or a sibling account/menu surface, but Settings should no longer be a catch-all Preferences modal.

**Planning implication:** Rename Preferences to Settings and define clear settings-only sections.

**Priority:** High.

---

### 18. Location, Account, and Settings should use consistent modal sizing

**Original feedback:** “Between location and account and settings, it should be… the same box size of the modal.”

**Covered in prior doc:** Mostly, but the prior doc framed it as only Settings modal stability.

**Correction:** The stronger direction is that modal-like surfaces across Location, Account, and Settings should share a consistent shell size and visual system.

**Planning implication:** Define a reusable modal shell component, e.g. `ModalShell`, with:

- fixed desktop width,
- fixed/max viewport height,
- stable header/footer,
- internal content scroll,
- consistent padding,
- responsive mobile behavior.

Then use it for Settings, Account, and Location flows if they are modal-based.

**Priority:** High.

---

### 19. Skin type is too large/long

**Original feedback:** “The skin type is taking up way too much space. And it’s too long…”

**Covered in prior doc:** Yes.

**Planning implication:** In Settings, use a compact skin selector. Keep detailed skin explanations in onboarding or behind an accordion/help disclosure.

**Priority:** High.

---

### 20. Preferences modal is not large enough

**Original feedback:** “…and preferences is not large enough.”

**Covered in prior doc:** Yes, but should be stated alongside stable modal shell.

**Planning implication:** Settings should probably be wider than the current 480px on desktop, around 560–640px. The goal is not just larger; it should be consistently sized and scroll internally.

**Priority:** High.

---

### 21. Settings can have different things inside it

**Original feedback:** “We should have settings and we can have different things in settings, right?”

**Covered in prior doc:** Yes.

**Planning implication:** Settings can still contain multiple sections/tabs, but only for actual settings/configuration, not primary product actions.

**Priority:** Medium-high.

---

### 22. Collapse suggestions and hide suggestions

**Original feedback:** “We should be able to collapse different suggestions and be able to hide suggestions…”

**Covered in prior doc:** Yes.

**Planning implication:** Add hidden/collapsed suggestion state, likely in preferences:

- `hiddenActivitySuggestionIds`
- `collapsedActivityCategories`

**Priority:** Medium.

---

### 23. Hidden suggestions belong in activity settings

**Original feedback:** “…in like activity settings, right?”

**Covered in prior doc:** Yes.

**Nuance:** Activity settings should mean management of activity defaults/suggestions, not activity creation.

**Planning implication:** Settings > Activity Preferences can include:

- hidden suggestions,
- restored suggestions,
- collapsed preset categories,
- default duration/default protection assumptions.

But not the primary picker/create flow.

**Priority:** Medium.

---

### 24. Activity settings should edit existing things, not pick activities

**Original feedback:** “Activities, if we go to settings, activities, we shouldn’t be able to pick activities from settings. We should be able to edit the things about activities that we would do in activities, or edit things we want about activities.”

**Covered in prior doc:** Mostly yes, but this exact distinction should be explicit.

**Corrected rule:** Settings can manage activity preferences, not active activity selection.

**Planning implication:** The active activity list belongs on the Dashboard. Settings may have advanced controls for how suggestions/defaults behave.

**Priority:** Very high.

---

### 25. Show hidden suggestions / pre-activities in settings

**Original feedback:** “Maybe we can show activities we’ve hidden, or add different pre-activities, or something.”

**Covered in prior doc:** Yes.

**Planning implication:** Activity Preferences can be a management surface for preset visibility. It can also eventually allow custom preset creation, but not as the main day-to-day activity add flow.

**Priority:** Medium.

---

### 26. Remove global no-sunscreen preference

**Original feedback:** “I don’t even like the idea of us recording the preference of no sunscreen.”

**Covered in prior doc:** Yes, but this should be treated as a model correction.

**Hard rule:** Do not ask users to globally record “no sunscreen” as a standing preference in the active UI.

**Planning implication:** The current global `UserPreferences.sunscreen` should become legacy/migration-only. New saves should rely on `activity.sunscreen`.

**Priority:** Very high.

---

### 27. Sunscreen should be directly related to activity

**Original feedback:** “It should be directly related to the activity.”

**Covered in prior doc:** Yes.

**Planning implication:** Activity add/edit flow should include sunscreen/protection assumption. Activity cards should display the assumption and calculations should depend on that activity-specific value.

**Priority:** Very high.

---

## Missing or underemphasized items from the first planning doc

### A. Activity creation out of Settings is a hard constraint

The prior plan covered this, but the implementation sequence should treat it as a hard product rule. The next activity PR should remove the activity picker/create flow from Settings, not merely add another way to create activities on the Dashboard.

### B. Consistent modal shell should apply beyond Settings

The prior plan emphasized stable Settings sizing. The original feedback is broader: Location, Account, and Settings should feel like they belong to the same modal system.

### C. Settings Activity section should be renamed/reframed

Calling it “Activities” inside Settings may keep implying that users select/create activities there. Better names:

- Activity preferences
- Preset suggestions
- Activity defaults
- Suggestion settings

### D. Global sunscreen should be deprecated more aggressively

The prior plan said to deprecate the global field, but the feedback is stronger: the product should not ask users to record “no sunscreen” globally. This should be removed from visible UI in the same PR that moves activity editing into the Dashboard.

### E. “Not animation, indication” matters

The sun arc should avoid complexity creep. The first version should be a visual indicator, not an animated feature.

## Updated implementation sequence

### PR 1 — Dashboard hierarchy and forecast gating

- Move tip carousel/fact card to the top.
- Make the card narrower and text larger.
- Increase dashboard typography.
- Enforce tier day visibility:
  - Guest: Today.
  - Free signed-in: Today + Tomorrow.
  - Pro: 10 days.
- Add the right CTA after visible days:
  - Guest: Sign in to see tomorrow.
  - Free: Go Pro for 10-day planning.

### PR 2 — Header and modal shell cleanup

- Move Pro/plan badge to the right side of the header.
- Define shared modal shell sizing for Settings/Location/Account-style surfaces.
- Rename Preferences to Settings.
- Move dark mode into Settings > Appearance.
- Make skin type compact.

### PR 3 — Main-page activity creation

- Add activity creation to the main Activity section.
- Remove active activity creation/picking from Settings.
- Make empty state open inline activity add flow.
- Let users edit/remove activities from activity cards.

### PR 4 — Per-activity sunscreen model

- Remove global sunscreen UI.
- Keep global sunscreen only as legacy migration fallback.
- Add sunscreen/protection control per activity.
- Update dashboard, calendar, and notifications copy/calculations.

### PR 5 — Settings Activity Preferences

- Add hidden suggestions/preset management.
- Add collapsed preset category state if useful.
- Let users restore hidden suggestions.
- Keep this separate from active activity creation.

### PR 6 — SunArc visual

- Add subtle static sun arc near UV by hour.
- Show current position for Today.
- Show peak UV marker.
- Avoid heavy animation.

## Final corrected product principle

Solara should have three clearly separate layers:

1. **Dashboard = planning surface**
   - Today/future day access.
   - UV and sun arc.
   - Activity windows.
   - Add/edit/remove activities.

2. **Settings = configuration surface**
   - Skin profile.
   - Appearance.
   - Location/account if not separated.
   - Activity suggestion preferences.

3. **Account/Plan = access surface**
   - Sign in.
   - Free vs Pro.
   - Tomorrow/10-day access.
   - Pro waitlist or upgrade.

The core correction is that activities are not settings. Activities are the product.
