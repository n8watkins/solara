// The dashboard's activity plan: what only a plan with activities shows (the hero
// slot, Plan ahead, the calendar banner and the activity cards) and the planning that
// finds their slots (useActivityPlanning in components/deferred.tsx). Setup creates no
// activities, so a new guest's dashboard never needs it; it loads as one chunk on
// demand, and the dashboard waits for it only when the plan has activities
// (ActivityPlanGate in components/deferred.tsx).
export { default as HeroSlot } from './HeroSlot'
export { default as PlanAhead } from '../PlanAhead'
export { default as CalendarConnectBanner } from './CalendarConnectBanner'
export { default as ActivityCards } from '../ActivityCards'
export { planActivityDay, soonestPlan } from '@solara/core/next-slot'
export { nextSlotAfterToday } from '@solara/core/planner'
