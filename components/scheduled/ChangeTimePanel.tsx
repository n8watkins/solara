import { useUnits } from '@/lib/use-units'
import { SheetActions, sheetAction } from '../BottomSheet'

/** An inset panel inside a sheet, for a step such as changing the time or confirming. */
export const sheetPanel =
  'mt-3.5 rounded-xl border-[0.5px] border-line-strong bg-surface-subtle p-3'

/** "Change time" for a scheduled activity: a start inside the day's lower-UV windows. */
export default function ChangeTimePanel({
  id,
  today,
  options,
  hours,
  picked,
  current,
  busy,
  onPick,
  onCancel,
  onSave,
}: {
  /** Id for the select, so its label points at it. */
  id: string
  /** The item is today (the label then says "today's"). */
  today: boolean
  /** Start hours that fit the duration inside a window. */
  options: number[]
  /** Duration in hours. */
  hours: number
  picked: number | null
  /** The current start, rounded to the minute. */
  current: number
  busy: boolean
  onPick: (start: number) => void
  onCancel: () => void
  onSave: () => void
}) {
  const fmt = useUnits()
  return (
    <div className={sheetPanel}>
      {options.length > 0 ? (
        <>
          <label className="mb-1.5 block text-[12px] font-semibold text-ink-2" htmlFor={id}>
            New start time, within {today ? "today's" : "the day's"} lower-UV windows
          </label>
          <select
            id={id}
            className="w-full px-2.5 py-2 text-[14px]"
            value={picked ?? ''}
            disabled={busy}
            onChange={e => onPick(Number(e.target.value))}
          >
            {options.map(h => (
              <option key={h} value={h}>
                {fmt.time(h)} – {fmt.time(h + hours)}
              </option>
            ))}
          </select>
        </>
      ) : (
        <p className="text-[12px] leading-[1.45] text-ink-3">
          No other lower-UV start time is left on this day for this activity.
        </p>
      )}
      <SheetActions>
        <button type="button" className={sheetAction} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={`${sheetAction} btn-primary`}
          disabled={busy || picked === null || picked === current}
          onClick={onSave}
        >
          {busy ? 'Saving…' : 'Save time'}
        </button>
      </SheetActions>
    </div>
  )
}
