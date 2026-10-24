import { useState } from 'react'
import type { DayWeather } from '@/lib/types'
import { LOCKED_DAYS_UPSELL, dayChips, type DashboardAccess } from '@/lib/dashboard-view'
import ActivityModalShell from '../ActivityModalShell'

type Access = Pick<
  DashboardAccess,
  'visibleForecast' | 'selectedDay' | 'lockedForecastCount' | 'showDayTabs'
>

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 cursor-pointer items-center gap-[5px] rounded-[10px] border-0 px-3.5 py-2 text-[13px] font-semibold transition-all duration-[120ms] ${
        active ? 'bg-accent text-accent-on' : 'bg-surface-metric text-ink'
      }`}
    >
      {label}
    </button>
  )
}

/**
 * The day picker, with no horizontal scroll: Today and Tomorrow are direct
 * chips, every later day is in a dialog behind "More days", and a plan with
 * locked days gets a locked "Next 10 days" tab that opens the Pro plans. The
 * refresh button always renders, so it stays reachable when only one day is
 * visible.
 */
export default function DayPicker({
  access,
  onSelectDay,
  onRefresh,
  onUpgrade,
}: {
  access: Access
  onSelectDay: (day: DayWeather | null) => void
  onRefresh: () => void
  /** Opens the Pro plans from the locked tab. */
  onUpgrade: () => void
}) {
  const [open, setOpen] = useState(false)
  const chips = dayChips(access)
  const { tomorrow, more } = chips
  return (
    <div data-testid="day-picker" className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {access.showDayTabs && (
          <>
            <Chip label="Today" active={chips.todayActive} onClick={() => onSelectDay(null)} />
            {tomorrow && (
              <Chip
                label="Tomorrow"
                active={chips.tomorrowActive}
                onClick={() => onSelectDay(tomorrow)}
              />
            )}
            {more && <Chip label={more.label} active={more.active} onClick={() => setOpen(true)} />}
            {chips.lockedDays > 0 && (
              <button
                onClick={onUpgrade}
                aria-label={LOCKED_DAYS_UPSELL}
                title={LOCKED_DAYS_UPSELL}
                className="flex shrink-0 cursor-pointer items-center gap-[5px] rounded-[10px] border-[0.5px] border-dashed border-accent-border bg-transparent px-3.5 py-2 text-[13px] font-semibold text-accent transition-all duration-[120ms]"
              >
                <span aria-hidden="true">🔒</span> Next 10 days
              </button>
            )}
          </>
        )}
      </div>
      <button
        className="btn btn-ghost shrink-0 px-[9px] py-[7px] text-[17px]"
        onClick={onRefresh}
        title="Refresh"
        aria-label="Refresh forecast"
      >
        ↻
      </button>

      {open && (
        <DayDialog
          access={access}
          onSelectDay={day => {
            onSelectDay(day)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function DayDialog({
  access,
  onSelectDay,
  onClose,
}: {
  access: Access
  onSelectDay: (day: DayWeather | null) => void
  onClose: () => void
}) {
  const { visibleForecast, selectedDay } = access
  return (
    <ActivityModalShell
      title="Choose a day"
      description="Pick any day in your forecast."
      onClose={onClose}
    >
      <div className="flex flex-col gap-2">
        {visibleForecast.map((day, i) => {
          const active = i === 0 ? !selectedDay : selectedDay?.dateStr === day.dateStr
          return (
            <button
              key={day.dateStr}
              onClick={() => onSelectDay(i === 0 ? null : day)}
              className={`flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-xl px-[15px] py-[13px] text-left text-[14px] font-semibold ${
                active
                  ? 'border-0 bg-accent text-accent-on'
                  : 'border-[0.5px] border-line-strong bg-surface-metric text-ink'
              }`}
            >
              <span>{day.label}</span>
              {active && <span className="text-[13px]">✓</span>}
            </button>
          )
        })}
      </div>
    </ActivityModalShell>
  )
}
