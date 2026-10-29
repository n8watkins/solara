'use client'
import { Droplets } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { claimDelivery, releaseDelivery } from '@/lib/notification-marker'
import { useOpenSettings } from '@/lib/open-settings'
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
  reapplyReminderMessage,
  startTimer,
  saveTimer,
  shouldNotify,
  withMode,
  withReminderTag,
  type ReapplyTimer as Timer,
} from '@/lib/reapply'
import {
  cancelReapplyReminder,
  hasNotificationDevice,
  reapplyPushAvailable,
  scheduleReapplyReminder,
} from '@/lib/reapply-reminder'
import type { TierLevel } from '@/lib/types'
import { useUnits } from '@/lib/use-units'

const TITLE = reapplyReminderMessage('standard').title

/** Whether the server's push will also bring the reminder, as far as this tab knows. */
type PushState = 'off' | 'pending' | 'devices' | 'no-devices' | 'failed'

/** A reminder is not handed to the server when it is this close: this tab reminds already. */
const MIN_PUSH_LEAD_MS = 60_000

type Permission = NotificationPermission | 'unsupported'

function notificationPermission(): Permission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

/**
 * Shows the reminder as a system notification: through the app's service worker
 * where there is one (required on Android), else with the page's Notification API.
 */
async function showReminder(body: string, tag = 'solara-reapply'): Promise<void> {
  if (notificationPermission() !== 'granted') return
  const options = { body, tag, icon: '/icon-192.png', badge: '/icon-192.png' }
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

/**
 * The reminder falling due in this tab: once per device, whether the server's push for
 * it (same tag) or this tab gets there first. A hidden tab shows a notification; a
 * visible one only marks it shown, since the card itself is the reminder.
 */
async function remindHere(timer: Timer, hidden: boolean): Promise<void> {
  const tag = timer.reminderTag
  if (tag && !(await claimDelivery(tag))) return
  if (!hidden) return
  try {
    await showReminder(reapplyReminderMessage(timer.mode).body, tag)
  } catch {
    if (tag) await releaseDelivery(tag)
  }
}

function intervalText(timer: Timer): string {
  return timer.mode === 'water'
    ? `Every ${REAPPLY_MINUTES.water} minutes while swimming or sweating`
    : `Every ${REAPPLY_MINUTES.standard / 60} hours`
}

export interface ReapplyTimerProps {
  /** The signed-in account, whose devices can get the reminder as a push; null for a guest. */
  uid?: string | null
  tier?: TierLevel
}

/**
 * The sunscreen reapply timer (lib/reapply.ts): start it when you head out and it
 * reminds you every 2 hours, or 80 minutes while swimming or sweating. The reminder
 * is this card, which turns into an alert, plus a system notification while Solara
 * is open in the background, where the browser allows one. Free for every plan,
 * guests included; it lives in this browser. For a signed-in account, once alerts are
 * switched on, the server also sends it as a push to the account's devices with
 * notifications on, so it arrives with Solara closed (lib/reapply-reminder.ts).
 */
export default function ReapplyTimer({ uid = null, tier }: ReapplyTimerProps = {}) {
  const id = useId()
  const units = useUnits()
  const openSettings = useOpenSettings()
  const [timer, setTimer] = useState<Timer | null>(() => loadTimer())
  const [now, setNow] = useState(() => Date.now())
  const [permission, setPermission] = useState<Permission>(notificationPermission)
  const push = uid && reapplyPushAvailable(tier) ? uid : null
  const [pushState, setPushState] = useState<PushState>('off')
  // Each schedule's own number, so a slow answer for an older one is ignored.
  const scheduleRun = useRef(0)

  function update(next: Timer | null) {
    saveTimer(next)
    setTimer(next)
    setNow(Date.now())
  }

  /**
   * Hands the timer's next reminder to the server (or stops the server's), then keeps
   * the push's tag with the timer so this tab and the push show one notification.
   */
  function syncPush(next: Timer | null) {
    if (!push) return
    const run = ++scheduleRun.current
    const current = () => run === scheduleRun.current
    if (!next || dueAt(next) - Date.now() < MIN_PUSH_LEAD_MS) {
      setPushState('off')
      void cancelReapplyReminder(push).catch(() => {})
      return
    }
    setPushState('pending')
    void (async () => {
      try {
        const { tag, committed } = await scheduleReapplyReminder(push, next)
        if (!current()) return
        const tagged = withReminderTag(next, tag)
        // Kept even before the server has it: offline, Firestore sends it later.
        update(tagged)
        const [devices] = await Promise.all([hasNotificationDevice(push), committed])
        if (current()) setPushState(devices ? 'devices' : 'no-devices')
      } catch {
        if (current()) setPushState('failed')
      }
    })()
  }

  function change(next: Timer | null) {
    update(next)
    syncPush(next)
  }

  // A timer from before this page loaded: say whether its push is coming.
  const knownTag = timer?.reminderTag
  useEffect(() => {
    if (!push || !knownTag) return
    let active = true
    hasNotificationDevice(push).then(
      devices => {
        if (active)
          setPushState(state => (state === 'off' ? (devices ? 'devices' : 'no-devices') : state))
      },
      () => {},
    )
    return () => {
      active = false
    }
  }, [push, knownTag])

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
      void remindHere(timer, document.visibilityState === 'hidden')
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
    change(startTimer(Date.now()))
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

  const tabNote =
    permission === 'granted'
      ? 'You get a notification while Solara stays open in a tab.'
      : permission === 'denied'
        ? 'Notifications are blocked, so the reminder shows here.'
        : 'The reminder shows here while Solara is open.'
  const note =
    pushState === 'devices'
      ? 'It also comes to your devices with alerts on, even with Solara closed.'
      : pushState === 'no-devices'
        ? null
        : tabNote

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
          onClick={() => change(reapplied(timer, Date.now()))}
        >
          I reapplied
        </button>
        <button
          type="button"
          className="btn"
          aria-pressed={timer.mode === 'water'}
          onClick={() => change(withMode(timer, timer.mode === 'water' ? 'standard' : 'water'))}
        >
          Swimming or sweating
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => change(null)}>
          Stop
        </button>
      </div>
      {!due && note && <p className="text-[11px] leading-[1.35] text-ink-3">{note}</p>}
      {!due && pushState === 'no-devices' && (
        <p className="text-[11px] leading-[1.35] text-ink-3">
          To get it with Solara closed,{' '}
          {openSettings ? (
            <button
              type="button"
              className="font-semibold text-accent underline underline-offset-2"
              onClick={() => openSettings('alerts')}
            >
              turn on alerts
            </button>
          ) : (
            'turn on alerts in Settings'
          )}{' '}
          for this device.
        </p>
      )}
    </section>
  )
}

/** The local clock time of an instant, as fractional hours for the unit formatters. */
function clockHours(ms: number): number {
  const date = new Date(ms)
  return date.getHours() + date.getMinutes() / 60
}
