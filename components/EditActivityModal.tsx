'use client'
import { useId, useState } from 'react'
import type { Activity, TimePreference } from '@/lib/types'
import { activityEdited } from '@/lib/activity-draft'
import { effectiveMaxUV } from '@/lib/tiers'
import { useUnits } from '@/lib/use-units'
import ActivityModalShell from './ActivityModalShell'
import EmojiPicker from './EmojiPicker'

interface Props {
  activity: Activity
  onSave: (activity: Activity) => void
  onDelete: (id: string) => void
  onClose: () => void
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

function clampUV(value: number) {
  return Math.max(0, Math.min(11, Math.round(value * 10) / 10))
}

export default function EditActivityModal({ activity, onSave, onDelete, onClose }: Props) {
  const fmt = useUnits()
  const [name, setName] = useState(activity.name)
  const [icon, setIcon] = useState(activity.icon)
  const [durationMins, setDurationMins] = useState(activity.durationMins)
  const [sunscreen, setSunscreen] = useState(activity.sunscreen)
  const [maxUV, setMaxUV] = useState(activity.maxUV)
  const [preferredEnabled, setPreferredEnabled] = useState(!!activity.preferredHours)
  const [preferredFrom, setPreferredFrom] = useState(activity.preferredHours?.from ?? 6)
  const [preferredTo, setPreferredTo] = useState(activity.preferredHours?.to ?? 20)
  const [timePreference, setTimePreference] = useState<TimePreference>(
    activity.timePreference ?? 'earliest',
  )
  const [days, setDays] = useState<number[]>(activity.daysOfWeek ?? [])
  const [cloudSensitive, setCloudSensitive] = useState(activity.cloudSensitive ?? false)
  const [showEmoji, setShowEmoji] = useState(false)
  const id = useId()
  const ids = {
    name: `${id}-name`,
    duration: `${id}-duration`,
    durationDesc: `${id}-duration-desc`,
    hours: `${id}-hours`,
    hoursDesc: `${id}-hours-desc`,
    time: `${id}-time`,
    timeDesc: `${id}-time-desc`,
    days: `${id}-days`,
    daysDesc: `${id}-days-desc`,
    spf: `${id}-spf`,
    spfDesc: `${id}-spf-desc`,
    cloud: `${id}-cloud`,
    cloudDesc: `${id}-cloud-desc`,
    uv: `${id}-uv`,
    uvDesc: `${id}-uv-desc`,
    emoji: `${id}-emoji`,
  }

  // All-seven or none both mean "every day" — store nothing (matches prefs normalizer).
  const draftDays =
    days.length === 0 || days.length === 7 ? undefined : [...days].sort((a, b) => a - b)
  function toggleDay(d: number) {
    setDays(cur => (cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d]))
  }

  const normalizedFrom = Math.max(0, Math.min(23, Math.round(preferredFrom)))
  const normalizedTo = Math.max(normalizedFrom + 1, Math.min(24, Math.round(preferredTo)))
  const draft: Activity = {
    ...activity,
    name: name.trim() || activity.name,
    icon,
    durationMins: Math.max(5, Math.round(durationMins || 5)),
    sunscreen,
    maxUV: clampUV(maxUV || 0),
    preferredHours: preferredEnabled ? { from: normalizedFrom, to: normalizedTo } : undefined,
    timePreference: timePreference === 'earliest' ? undefined : timePreference,
    daysOfWeek: draftDays,
    cloudSensitive: cloudSensitive || undefined,
  }

  const dirty = activityEdited(activity, draft)

  function requestClose() {
    if (dirty && !window.confirm('Discard unsaved activity changes?')) return
    onClose()
  }

  function handleDelete() {
    if (!window.confirm(`Remove ${activity.name}?`)) return
    onDelete(activity.id)
  }

  const effectiveUV = effectiveMaxUV(draft)

  return (
    <ActivityModalShell
      title="Edit activity"
      description="Customize the activity used for lower-UV planning, sharing, and calendar actions."
      onClose={requestClose}
      footer={
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className="btn"
            onClick={handleDelete}
            style={{ color: 'var(--danger)', borderColor: '#FECACA' }}
          >
            Delete
          </button>
          <div style={{ display: 'flex', gap: '10px', marginLeft: 'auto' }}>
            <button type="button" className="btn" onClick={requestClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onSave(draft)}
              disabled={!name.trim()}
            >
              Save activity
            </button>
          </div>
        </div>
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '14px',
          alignItems: 'start',
        }}
      >
        <div
          className="metric-card"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px', gridColumn: '1 / -1' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                aria-expanded={showEmoji}
                aria-haspopup="dialog"
                aria-controls={showEmoji ? ids.emoji : undefined}
                onClick={() => setShowEmoji(s => !s)}
                style={{
                  width: '50px',
                  height: '50px',
                  fontSize: '25px',
                  borderRadius: '14px',
                  border: '0.5px solid var(--border-md)',
                  background: 'var(--bg-card)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Change activity icon"
              >
                {icon}
              </button>
              {showEmoji && (
                <EmojiPicker
                  id={ids.emoji}
                  value={icon}
                  onChange={setIcon}
                  onClose={() => setShowEmoji(false)}
                />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <label
                htmlFor={ids.name}
                style={{
                  display: 'block',
                  fontSize: '12px',
                  color: 'var(--text-3)',
                  marginBottom: '5px',
                }}
              >
                Activity name
              </label>
              <input
                id={ids.name}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Activity name"
                style={{ width: '100%', boxSizing: 'border-box', fontSize: '15px' }}
              />
            </div>
          </div>
        </div>

        <div
          className="metric-card"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div>
            <h3
              id={ids.duration}
              style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}
            >
              Duration
            </h3>
            <p
              id={ids.durationDesc}
              style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.45 }}
            >
              How long you usually need for this activity.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              onClick={() => setDurationMins(m => Math.max(5, m - 15))}
            >
              −15m
            </button>
            <input
              type="number"
              min="5"
              step="5"
              value={durationMins}
              aria-labelledby={ids.duration}
              aria-describedby={ids.durationDesc}
              onChange={e => setDurationMins(Math.max(5, parseInt(e.target.value) || 5))}
              style={{ width: '96px', fontSize: '14px' }}
            />
            <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>minutes</span>
            <button type="button" className="btn" onClick={() => setDurationMins(m => m + 15)}>
              +15m
            </button>
          </div>
        </div>

        <div
          className="metric-card"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '12px',
              alignItems: 'flex-start',
            }}
          >
            <div>
              <h3
                id={ids.hours}
                style={{
                  margin: '0 0 4px',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--text)',
                }}
              >
                Preferred hours
              </h3>
              <p
                id={ids.hoursDesc}
                style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.45 }}
              >
                Limit recommendations to the part of the day you actually care about.
              </p>
            </div>
            <button
              type="button"
              aria-pressed={preferredEnabled}
              aria-describedby={ids.hoursDesc}
              className={preferredEnabled ? 'btn btn-primary' : 'btn'}
              onClick={() => setPreferredEnabled(v => !v)}
              style={{ fontSize: '12px', whiteSpace: 'nowrap' }}
            >
              {preferredEnabled ? 'Enabled' : 'Any time'}
            </button>
          </div>
          {preferredEnabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                  fontSize: '12px',
                  color: 'var(--text-3)',
                }}
              >
                Earliest
                <select
                  value={normalizedFrom}
                  onChange={e => setPreferredFrom(Number(e.target.value))}
                  style={{ fontSize: '13px' }}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {fmt.hour(h)}
                    </option>
                  ))}
                </select>
              </label>
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                  fontSize: '12px',
                  color: 'var(--text-3)',
                }}
              >
                Latest
                <select
                  value={normalizedTo}
                  onChange={e => setPreferredTo(Number(e.target.value))}
                  style={{ fontSize: '13px' }}
                >
                  {Array.from({ length: 24 }, (_, i) => i + 1).map(h => (
                    <option key={h} value={h}>
                      {fmt.hour(h)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        <div
          className="metric-card"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div>
            <h3
              id={ids.time}
              style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}
            >
              Preferred time
            </h3>
            <p
              id={ids.timeDesc}
              style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.45 }}
            >
              When several lower-UV times match, which should Solara recommend?
            </p>
          </div>
          <div
            role="group"
            aria-labelledby={ids.time}
            aria-describedby={ids.timeDesc}
            style={{ display: 'flex', gap: '8px' }}
          >
            {(
              [
                { val: 'earliest', label: 'Earliest', hint: 'Soonest free slot' },
                { val: 'latest', label: 'Latest', hint: 'Latest matching slot' },
                { val: 'sunniest', label: 'Sunniest', hint: 'Most sun within limit' },
              ] as const
            ).map(o => (
              <button
                key={o.val}
                type="button"
                aria-pressed={timePreference === o.val}
                onClick={() => setTimePreference(o.val)}
                title={o.hint}
                style={{
                  flex: 1,
                  padding: '9px 8px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  border:
                    timePreference === o.val
                      ? '1.5px solid var(--accent)'
                      : '0.5px solid var(--border-md)',
                  background: timePreference === o.val ? 'var(--accent-soft)' : 'var(--bg-card)',
                  color: 'var(--text)',
                  fontSize: '13px',
                  fontWeight: 650,
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className="metric-card"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div>
            <h3
              id={ids.days}
              style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}
            >
              Days
            </h3>
            <p
              id={ids.daysDesc}
              style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.45 }}
            >
              Which days this activity should be planned for, such as a weekday run or a weekend
              hike.
            </p>
          </div>
          <div
            role="group"
            aria-labelledby={ids.days}
            aria-describedby={ids.daysDesc}
            style={{ display: 'flex', gap: '6px' }}
          >
            {(['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const).map((label, d) => {
              const on = days.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  aria-pressed={on}
                  aria-label={DAY_NAMES[d]}
                  title={DAY_NAMES[d]}
                  style={{
                    flex: 1,
                    padding: '9px 0',
                    borderRadius: '9px',
                    cursor: 'pointer',
                    border: on ? '1.5px solid var(--accent)' : '0.5px solid var(--border-md)',
                    background: on ? 'var(--accent-soft)' : 'var(--bg-card)',
                    color: on ? 'var(--accent)' : 'var(--text-3)',
                    fontSize: '13px',
                    fontWeight: 700,
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { label: 'Every day', set: [] as number[] },
              { label: 'Weekdays', set: [1, 2, 3, 4, 5] },
              { label: 'Weekends', set: [0, 6] },
            ].map(p => (
              <button
                key={p.label}
                type="button"
                className="btn"
                onClick={() => setDays(p.set)}
                style={{ fontSize: '12px', padding: '5px 9px' }}
              >
                {p.label}
              </button>
            ))}
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '12px',
                color: 'var(--text-3)',
                alignSelf: 'center',
              }}
            >
              {draftDays ? `${days.length} day${days.length === 1 ? '' : 's'}` : 'Every day'}
            </span>
          </div>
        </div>

        <div
          className="metric-card"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div>
            <h3
              id={ids.spf}
              style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}
            >
              Sun protection
            </h3>
            <p
              id={ids.spfDesc}
              style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.45 }}
            >
              SPF changes the planning UV limit for this activity.
            </p>
          </div>
          <div
            role="group"
            aria-labelledby={ids.spf}
            aria-describedby={ids.spfDesc}
            style={{ display: 'flex', gap: '8px' }}
          >
            {[
              { val: false, label: 'No SPF' },
              { val: true, label: 'SPF 30+' },
            ].map(option => (
              <button
                key={String(option.val)}
                type="button"
                aria-pressed={sunscreen === option.val}
                onClick={() => setSunscreen(option.val)}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: '11px',
                  border:
                    sunscreen === option.val
                      ? '1.5px solid var(--accent)'
                      : '0.5px solid var(--border-md)',
                  background: sunscreen === option.val ? 'var(--accent-soft)' : 'var(--bg-card)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 650,
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className="metric-card"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '12px',
              alignItems: 'flex-start',
            }}
          >
            <div>
              <h3
                id={ids.cloud}
                style={{
                  margin: '0 0 4px',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--text)',
                }}
              >
                Account for cloud cover
              </h3>
              <p
                id={ids.cloudDesc}
                style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.45 }}
              >
                Heavy cloud lowers UV, so a borderline hour can become workable. Conservative: thin
                cloud still counts as full sun.
              </p>
            </div>
            <button
              type="button"
              aria-pressed={cloudSensitive}
              id={`${ids.cloud}-toggle`}
              aria-labelledby={`${ids.cloud} ${ids.cloud}-toggle`}
              aria-describedby={ids.cloudDesc}
              className={cloudSensitive ? 'btn btn-primary' : 'btn'}
              onClick={() => setCloudSensitive(v => !v)}
              style={{ fontSize: '12px', whiteSpace: 'nowrap' }}
            >
              {cloudSensitive ? 'On' : 'Off'}
            </button>
          </div>
        </div>

        <div
          className="metric-card"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px', gridColumn: '1 / -1' }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '12px',
              alignItems: 'flex-start',
            }}
          >
            <div>
              <h3
                id={ids.uv}
                style={{
                  margin: '0 0 4px',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--text)',
                }}
              >
                <label htmlFor={`${ids.uv}-range`}>Base planning UV limit</label>
              </h3>
              <p
                id={ids.uvDesc}
                style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)', lineHeight: 1.45 }}
              >
                Lower is more conservative. SPF may raise the effective threshold.
              </p>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-3)' }}>
                Effective planning limit
              </p>
              <p
                style={{
                  margin: '2px 0 0',
                  fontSize: '22px',
                  fontWeight: 800,
                  color: 'var(--accent)',
                }}
              >
                {effectiveUV}
              </p>
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="11"
            step="0.5"
            value={maxUV}
            id={`${ids.uv}-range`}
            aria-describedby={ids.uvDesc}
            onChange={e => setMaxUV(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>Strict</span>
            <input
              type="number"
              min="0"
              max="11"
              step="0.5"
              value={maxUV}
              aria-labelledby={ids.uv}
              onChange={e => setMaxUV(clampUV(parseFloat(e.target.value) || 0))}
              style={{ width: '90px', fontSize: '13px', textAlign: 'center' }}
            />
            <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>Flexible</span>
          </div>
        </div>
      </div>
    </ActivityModalShell>
  )
}
