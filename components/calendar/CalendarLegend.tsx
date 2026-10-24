import { NO_DATA_BG } from '@/lib/calendar-grid'
import { UV_BANDS } from '@/lib/calendar-layout'
import type { Activity } from '@/lib/types'

const uvKey = 'flex items-center gap-[5px] text-[11px] text-ink-3'
const uvSwatch = 'size-2.5 rounded-[2px]'

/** Activity colors on the left; UV bands (and the no-data hatch, when shown) on the right. */
export default function CalendarLegend({
  activities,
  colorFor,
  showNoData,
}: {
  activities: readonly Activity[]
  colorFor: (act: Pick<Activity, 'id'>) => string
  showNoData: boolean
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {activities.map(a => (
          <span key={a.id} className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colorFor(a) }} />
            {a.icon} {a.name}
          </span>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap gap-x-2.5 gap-y-1.5">
        {UV_BANDS.filter(b => b.label).map(b => (
          <span key={b.label} className={uvKey}>
            <span className={uvSwatch} style={{ background: `rgba(${b.rgb},0.45)` }} />
            {b.label} UV
          </span>
        ))}
        {showNoData && (
          <span className={uvKey}>
            <span
              className={`${uvSwatch} shadow-[inset_0_0_0_0.5px_var(--border-md)]`}
              style={{ background: NO_DATA_BG }}
            />
            No UV data
          </span>
        )}
      </div>
    </div>
  )
}
