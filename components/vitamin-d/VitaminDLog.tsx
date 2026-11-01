'use client'
// The vitamin D log (ROADMAP item 48): sessions in the sun with their estimated vitamin D
// and burn risk, today's and the last 7 days' totals and a 7-day chart, kept only in this
// browser. Opened from the dashboard (components/deferred.tsx loads it on demand), or by
// an activity card's "Log it", which logs the finished activity first.
import { useEffect, useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  dailyTotals,
  entryEstimate,
  logExport,
  startHour,
  type VitaminDEntry,
} from '@solara/core/vitamin-d-log'
import { DAILY_REFERENCE_IU, DAILY_REFERENCE_IU_OVER_70 } from '@solara/core/vitamin-d'
import { formatNumber } from '@solara/core/i18n'
import { formatDuration } from '@solara/core/duration'
import { formatUV } from '@solara/core/uv-scale'
import { useUnits } from '@/lib/use-units'
import { formatDate, timeRange } from '@/lib/time'
import { loadVitaminDLog, newEntryId, saveVitaminDLog, clearVitaminDLog } from '@/lib/vitamin-d-log'
import {
  activityEntry,
  entryOf,
  formOf,
  meanUv,
  newForm,
  readForm,
  type ActivityToLog,
  type FormField,
  type LogContext,
  type SessionForm as Form,
} from '@/lib/vitamin-d-view'
import ActivityModalShell from '../ActivityModalShell'
import SessionEstimateLines from './SessionEstimateLines'
import SessionForm, { exposureName } from './SessionForm'
import WeekChart, { iuText } from './WeekChart'
import m from '@/messages/vitamin-d'

export interface VitaminDLogProps extends LogContext {
  /** A finished activity to log first, from its card's "Log it". */
  logActivity?: ActivityToLog | null
  onClose: () => void
}

type View = { kind: 'list' } | { kind: 'form'; editing: VitaminDEntry | null }

interface Status {
  text: string
  /** The log before a deletion, for Undo. */
  undo?: VitaminDEntry[]
}

const FORM_ID = 'vitd-session-form'

export default function VitaminDLog({ logActivity, onClose, ...context }: VitaminDLogProps) {
  const { today } = context
  const fmt = useUnits()
  const [entries, setEntries] = useState(() => loadVitaminDLog(today))
  const [view, setView] = useState<View>({ kind: 'list' })
  const [form, setForm] = useState<Form>(() => newForm(context))
  const [errors, setErrors] = useState<FormField[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false)
  const listHeading = useRef<HTMLHeadingElement>(null)
  const logged = useRef(false)

  /** Keeps `next`; false (and a message) when the browser refuses. */
  function keep(next: readonly VitaminDEntry[]): boolean {
    try {
      setEntries(saveVitaminDLog(next, today))
      return true
    } catch {
      setStatus({ text: m.saveFailed })
      return false
    }
  }

  // "Log it": the finished activity goes into browser storage once, then the log shows it
  // to check. Storage is outside React, so the state follows the write.
  useEffect(() => {
    if (!logActivity || logged.current) return
    logged.current = true
    const current = loadVitaminDLog(today)
    let next: Status
    if (current.some(entry => entry.date === today && entry.activityId === logActivity.id)) {
      next = { text: m.alreadyLogged(logActivity.name) }
    } else {
      try {
        const entry = activityEntry(logActivity, context, newEntryId())
        const kept = saveVitaminDLog([entry, ...current], today)
        /* eslint-disable-next-line react-hooks/set-state-in-effect -- reflects the write to browser storage just made */
        setEntries(kept)
        next = { text: m.logged(logActivity.name) }
      } catch {
        next = { text: m.saveFailed }
      }
    }
    setStatus(next)
    // Runs once, for the activity the log was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Back on the list after a form, focus returns to its heading.
  const previousView = useRef(view.kind)
  useEffect(() => {
    if (previousView.current === 'form' && view.kind === 'list') listHeading.current?.focus()
    previousView.current = view.kind
  }, [view.kind])

  function openForm(editing: VitaminDEntry | null) {
    setForm(editing ? formOf(editing) : newForm(context))
    setErrors([])
    setStatus(null)
    setConfirmingDeleteAll(false)
    setView({ kind: 'form', editing })
  }

  function save() {
    if (view.kind !== 'form') return
    const { editing } = view
    const result = readForm(form, context, editing)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    const entry = entryOf(form, result, {
      id: editing?.id ?? newEntryId(),
      skinType: context.skinType,
      editing,
    })
    const next = editing ? entries.map(e => (e.id === editing.id ? entry : e)) : [entry, ...entries]
    if (keep(next)) setView({ kind: 'list' })
  }

  function remove(entry: VitaminDEntry) {
    const before = entries
    if (keep(entries.filter(e => e.id !== entry.id))) {
      setStatus({ text: m.deleted, undo: before })
    }
  }

  function undo() {
    if (status?.undo && keep(status.undo)) setStatus(null)
  }

  function deleteAll() {
    clearVitaminDLog()
    setEntries([])
    setConfirmingDeleteAll(false)
    setStatus({ text: m.deletedAll })
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(logExport(entries), null, 2)], { type: 'application/json' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `solara-vitamin-d-log-${today}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const totals = dailyTotals(entries, today)
  const todayIu = totals.at(-1)?.iu ?? 0
  const weekIu = totals.reduce((sum, total) => sum + total.iu, 0)

  const dayText = (date: string) =>
    date === today
      ? m.today
      : formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' })

  function whenText(entry: VitaminDEntry): string {
    const from = startHour(entry.start)
    const to = (from + entry.minutes / 60) % 24
    return m.sessionWhen(
      dayText(entry.date),
      timeRange(fmt.time(from), fmt.time(to)),
      formatDuration(entry.minutes),
    )
  }

  if (view.kind === 'form') {
    return (
      <ActivityModalShell
        variant="narrow"
        title={view.editing ? m.editTitle : m.addTitle}
        onClose={() => setView({ kind: 'list' })}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setView({ kind: 'list' })}>
              {m.cancel}
            </button>
            <button type="submit" form={FORM_ID} className="btn btn-primary">
              {m.save}
            </button>
          </div>
        }
      >
        <SessionForm
          id={FORM_ID}
          form={form}
          onChange={next => {
            setForm(next)
            if (errors.length > 0) setErrors([])
          }}
          errors={errors}
          context={context}
          editing={view.editing}
          onSubmit={save}
        />
      </ActivityModalShell>
    )
  }

  return (
    <ActivityModalShell
      variant="narrow"
      title={m.title}
      description={m.lead}
      onClose={onClose}
      footer={
        confirmingDeleteAll ? (
          <div className="flex flex-col gap-2.5" role="group" aria-labelledby="vitd-confirm-all">
            <p id="vitd-confirm-all" className="text-[13px] font-medium text-ink">
              {m.confirmDeleteAll(entries.length)}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn" onClick={() => setConfirmingDeleteAll(false)}>
                {m.keep}
              </button>
              <button
                type="button"
                className="btn border-danger/30 text-danger"
                onClick={deleteAll}
              >
                {m.confirmDeleteAllAction}
              </button>
            </div>
          </div>
        ) : entries.length > 0 ? (
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" className="btn" onClick={download}>
              {m.download}
            </button>
            <button
              type="button"
              className="btn border-danger/30 text-danger"
              onClick={() => setConfirmingDeleteAll(true)}
            >
              {m.deleteAll}
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex min-h-0 flex-col" role="status">
          {status && (
            <div className="flex items-center justify-between gap-3 rounded-xl border-[0.5px] border-brand/20 bg-brand/8 px-3.5 py-2.5 text-[13px] text-ink-2">
              <span>{status.text}</span>
              {status.undo && (
                <button
                  type="button"
                  className="btn btn-ghost shrink-0 px-2 py-1 font-semibold text-accent"
                  onClick={undo}
                >
                  {m.undo}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: m.today, iu: todayIu, id: 'today' },
              { label: m.last7Days, iu: weekIu, id: 'week' },
            ].map(total => (
              <div key={total.id} className="metric-card" data-testid={`vitd-total-${total.id}`}>
                <p className="text-[12px] text-ink-3">{total.label}</p>
                <p className="mt-0.5 text-[17px] leading-tight font-bold text-ink">
                  {iuText(total.iu)}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-3">{m.estimateLabel}</p>
              </div>
            ))}
          </div>
          <p className="text-[12px] leading-[1.45] text-ink-3">
            {m.comparison(
              formatNumber(DAILY_REFERENCE_IU),
              formatNumber(DAILY_REFERENCE_IU_OVER_70),
            )}
          </p>
        </div>

        <WeekChart totals={totals} today={today} />

        <section className="flex flex-col gap-2.5" aria-labelledby="vitd-sessions">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3
              id="vitd-sessions"
              ref={listHeading}
              tabIndex={-1}
              className="text-[14px] font-bold text-ink outline-none"
            >
              {m.sessions}
            </h3>
            <button type="button" className="btn btn-primary" onClick={() => openForm(null)}>
              <Plus size={15} aria-hidden="true" />
              {m.addSession}
            </button>
          </div>
          {entries.length === 0 ? (
            <p className="text-[13px] leading-[1.45] text-ink-3">{m.empty}</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="vitd-sessions">
              {entries.map(entry => {
                const name = entry.label ?? m.session
                const when = whenText(entry)
                return (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-2 rounded-xl border-[0.5px] border-line-strong bg-surface-metric px-3.5 py-3"
                    data-testid="vitd-session"
                  >
                    <div>
                      <p className="text-[13px] font-semibold text-ink">{name}</p>
                      <p className="text-[12px] text-ink-3">{when}</p>
                    </div>
                    <SessionEstimateLines estimate={entryEstimate(entry)} />
                    <p className="text-[11px] text-ink-3">
                      {m.details(
                        exposureName(entry.exposure),
                        formatUV(meanUv(entry.uv)),
                        entry.sunscreen ? m.withSunscreen : m.noSunscreen,
                      )}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn px-2.5 py-1 text-[12px]"
                        aria-label={m.editNamed(`${name}, ${when}`)}
                        onClick={() => openForm(entry)}
                      >
                        <Pencil size={13} aria-hidden="true" />
                        {m.edit}
                      </button>
                      <button
                        type="button"
                        className="btn px-2.5 py-1 text-[12px] text-danger"
                        aria-label={m.deleteNamed(`${name}, ${when}`)}
                        onClick={() => remove(entry)}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                        {m.delete}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <details className="rounded-xl border-[0.5px] border-line-strong px-3.5 py-2.5 text-[12px] leading-[1.5] text-ink-2">
          <summary className="cursor-pointer text-[13px] font-semibold text-ink">
            {m.howTitle}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <p>{m.howModel}</p>
            <p>{m.howLowSun}</p>
            <p>{m.howSunscreen}</p>
            <p>{m.howLimits}</p>
          </div>
        </details>

        <p className="text-[11px] leading-normal text-ink-3">{m.deviceOnly}</p>
      </div>
    </ActivityModalShell>
  )
}
