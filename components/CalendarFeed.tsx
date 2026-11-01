'use client'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { loadedFirebase } from '@/lib/firebase'
import type { FeedTokenState } from '@/lib/feed'
import {
  buildFeedUrl,
  isFeedConfigured,
  revokeFeedToken,
  rotateFeedToken,
  watchFeedToken,
} from '@/lib/feed'
import type { UserPreferences } from '@/lib/types'
import m from '@/messages/calendar'

interface Props {
  prefs: UserPreferences
  /** Not used: the feed token is server-owned now. Kept so existing call sites compile. */
  onPrefsUpdate?: (prefs: UserPreferences) => void
}

type Busy = 'create' | 'regenerate' | 'revoke' | null

const hint = 'text-[13px] text-ink-2'
const small = 'btn text-[12px]'

/**
 * Live calendar feed. Lets a signed-in user subscribe their calendar app to a stable URL
 * that re-fetches as the forecast changes, unlike the one-shot .ics export. The server
 * mints and stores the link's token; this component only shows, rotates or revokes it.
 */
export default function CalendarFeed({ prefs }: Props) {
  const uid = prefs.uid
  const configured = isFeedConfigured() && !!uid

  // Hidden when the Functions are not deployed or nobody is signed in.
  if (!configured) return null
  return <CalendarFeedPanel key={uid} uid={uid} />
}

function CalendarFeedPanel({ uid }: { uid: string }) {
  const [feed, setFeed] = useState<FeedTokenState>({ status: 'loading' })
  const [busy, setBusy] = useState<Busy>(null)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => watchFeedToken(uid, setFeed, () => setMessage(m.feedLoadFailed)), [uid])

  const token = feed.status === 'ready' ? feed.token : null
  const url = token ? buildFeedUrl(token) : null

  function currentUser() {
    // Only a signed-in account sees the feed, so Firebase has loaded.
    const user = loadedFirebase()?.auth?.currentUser
    if (!user || user.uid !== uid) throw new Error(m.feedSignInAgain)
    return user
  }

  async function run(kind: Exclude<Busy, null>, action: () => Promise<unknown>) {
    setBusy(kind)
    setMessage('')
    setCopied(false)
    try {
      await action()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : m.somethingWrong)
    } finally {
      setBusy(null)
    }
  }

  function create() {
    void run('create', () => rotateFeedToken(currentUser()))
  }

  function regenerate() {
    if (!confirm(m.feedRegenerateConfirm)) return
    void run('regenerate', () => rotateFeedToken(currentUser()))
  }

  function revoke() {
    if (!confirm(m.feedTurnOffConfirm)) return
    void run('revoke', () => revokeFeedToken(currentUser()))
  }

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked - the field is selectable as a fallback */
    }
  }

  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-[10px] border-[0.5px] border-line-strong bg-surface-metric px-3 py-2.5">
      <RefreshCw size={16} className="mt-0.5 shrink-0 text-ink-3" />
      <div className="min-w-0 flex-1">
        {feed.status === 'loading' ? (
          <p className={hint}>{m.feedLoading}</p>
        ) : !url ? (
          <>
            <p className={hint}>{m.feedPitch}</p>
            <button
              type="button"
              className={`${small} mt-2`}
              onClick={create}
              disabled={busy !== null}
            >
              {busy === 'create' ? m.creating : m.createFeed}
            </button>
          </>
        ) : (
          <>
            <label htmlFor="calendar-feed-url" className={`${hint} block`}>
              {m.feedAddUrl}
            </label>
            <input
              id="calendar-feed-url"
              type="text"
              readOnly
              value={url}
              onFocus={e => e.currentTarget.select()}
              className="mt-2 box-border w-full rounded-lg border-[0.5px] border-line-strong bg-surface px-[9px] py-[7px] text-[12px] text-ink-2"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={small}
                onClick={() => void copy()}
                disabled={busy !== null}
              >
                {copied ? m.copied : m.copyLink}
              </button>
              <button
                type="button"
                className={`${small} text-ink-3`}
                onClick={regenerate}
                disabled={busy !== null}
              >
                {busy === 'regenerate' ? m.regenerating : m.regenerate}
              </button>
              <button
                type="button"
                className={`${small} text-ink-3`}
                onClick={revoke}
                disabled={busy !== null}
              >
                {busy === 'revoke' ? m.turningOff : m.turnOff}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-ink-3">{m.feedPrivate}</p>
          </>
        )}
        {message && (
          <p role="status" className="mt-2 text-[12px] text-ink-2">
            {message}
          </p>
        )}
      </div>
    </div>
  )
}
