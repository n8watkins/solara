'use client'
import { Droplets } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import {
  REAPPLY_MINUTES,
  REAPPLY_STORAGE_KEY,
  dueAt,
  formatDuration,
  isDue,
  loadTimer,
  markNotified,
  minutesLeft,
  reapplied,
  startTimer,
  saveTimer,
  shouldNotify,
  withMode,
  type ReapplyTimer as Timer,
} from '@/lib/reapply'
import { useUnits } from '@/lib/use-units'

const TITLE = 'Time to reapply sunscreen'

type Permission = NotificationPermission | 'unsupported'

function notificationPermission(): Permission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

/**
 * Shows the reminder as a system notification: through the app's service worker
 * where there is one (required on Android), else with the page's Notification API.
 */
async function showReminder(body: string): Promise<void> {
  if (notificationPermission() !== 'granted') return
  const options = { body, tag: 'solara-reapply', icon: '/icon-192.png', badge: '/icon-192.png' }
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    if (registration) {
      await registration.showNotification(TITLE, { ...options, data: { link: '/app/' } })
      return
    }
  } catch {}
  try {
    new Notification(TITLE, options)
  } catch {
    // Some browsers allow notifications only from a service worker; the banner remains.
  }
}

function intervalText(timer: Timer): string {
  return timer.mode === 'water'
    ? `Every ${REAPPLY_MINUTES.water} minutes while swimming or sweating`
    : `Every ${REAPPLY_MINUTES.standard / 60} hours`
}

/**
 * The sunscreen reapply timer (lib/reapply.ts): start it when you head out and it
 * reminds you every 2 hours, or 80 minutes while swimming or sweating. The reminder
 * is this card, which turns into an alert, plus a system notification while Solara
 * is open in the background, where the browser allows one. Free for every plan,
 * guests included; it lives in this browser.
 */
export default function ReapplyTimer() {
  const id = useId()
  const units = useUnits()
  const [timer, setTimer] = useState<Timer | null>(() => loadTimer())
  const [now, setNow] = useState(() => Date.now())
  const [permission, setPermission] = useState<Permission>(notificationPermission)

  function update(next: Timer | null) {
    saveTimer(next)
    setTimer(next)
    setNow(Date.now())
  }

  // Another tab started, reset or stopped the timer.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== REAPPLY_STORAGE_KEY) return
      setTimer(loadTimer())
      setNow(Date.now())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // A minute counter while it runs, and a wake-up when it falls due. Once per reminder,
  // the wake-up also shows a notification if the page is hidden; the card always shows it.
  useEffect(() => {
    if (!timer) return
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    const wake = () => {
      const current = Date.now()
      setNow(current)
      if (!shouldNotify(timer, current)) return
      if (document.visibilityState === 'hidden') {
        void showReminder(
          timer.mode === 'water'
            ? `It has been ${REAPPLY_MINUTES.water} minutes of swimming or sweating since you put it on.`
            : `It has been ${REAPPLY_MINUTES.standard / 60} hours since you put it on.`,
        )
      }
      const next = markNotified(timer)
      saveTimer(next)
      setTimer(next)
    }
    const due = setTimeout(wake, Math.max(0, dueAt(timer) - Date.now()) + 50)
    return () => {
      clearInterval(tick)
      clearTimeout(due)
    }
  }, [timer])

  async function start() {
    update(startTimer(Date.now()))
    // Asked inside the click, as browsers require, and only once.
    if (permission === 'default') {
      try {
        setPermission(await Notification.requestPermission())
      } catch {
        setPermission(notificationPermission())
      }
    }
  }

  const titleId = `${id}-title`
  const due = timer ? isDue(timer, now) : false

  if (!timer) {
    return (
      <section
        aria-labelledby={titleId}
        className="metric-card flex min-h-16 items-center gap-3 px-3 py-2.5"
      >
        <Droplets size={20} aria-hidden="true" className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[13px] leading-[1.2] font-bold text-ink">
            Sunscreen timer
          </h2>
          <p className="mt-0.5 text-[12px] leading-[1.35] text-ink-3">
            Heading out? Get a reminder to reapply every 2 hours.
          </p>
        </div>
        <button type="button" className="btn btn-primary shrink-0" onClick={() => void start()}>
          Start
        </button>
      </section>
    )
  }

  const note =
    permission === 'granted'
      ? 'You get a notification while Solara stays open in a tab.'
      : permission === 'denied'
        ? 'Notifications are blocked, so the reminder shows here.'
        : 'The reminder shows here while Solara is open.'

  return (
    <section
      aria-labelledby={titleId}
      className={
        due
          ? 'flex flex-col gap-2.5 rounded-xl border-[0.5px] border-accent bg-accent/10 px-3 py-2.5'
          : 'metric-card flex flex-col gap-2.5 px-3 py-2.5'
      }
    >
      <div className="flex items-start gap-3">
        <Droplets size={20} aria-hidden="true" className="mt-px shrink-0 text-accent" />
        {/* Remounted when it falls due, so screen readers announce the alert. */}
        <div
          key={due ? 'due' : 'running'}
          className="min-w-0 flex-1"
          role={due ? 'alert' : undefined}
        >
          <h2 id={titleId} className="text-[13px] leading-[1.2] font-bold text-ink">
            {due ? TITLE : `Reapply sunscreen at ${units.time(clockHours(dueAt(timer)))}`}
          </h2>
          <p className="mt-0.5 text-[12px] leading-[1.35] text-ink-2">
            {due
              ? `Last put on at ${units.time(clockHours(timer.appliedAt))}.`
              : `In ${formatDuration(minutesLeft(timer, now))}. ${intervalText(timer)}.`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={due ? 'btn btn-primary' : 'btn'}
          onClick={() => update(reapplied(timer, Date.now()))}
        >
          I reapplied
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={timer.mode === 'water'}
          onClick={() => update(withMode(timer, timer.mode === 'water' ? 'standard' : 'water'))}
        >
          Swimming or sweating
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => update(null)}>
          Stop
        </button>
      </div>
      {!due && <p className="text-[11px] leading-[1.35] text-ink-3">{note}</p>}
    </section>
  )
}

/** The local clock time of an instant, as fractional hours for the unit formatters. */
function clockHours(ms: number): number {
  const date = new Date(ms)
  return date.getHours() + date.getMinutes() / 60
}
