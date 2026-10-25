// The dashboard's sun safety tip: one static tip per visit, a different one each
// visit, hidden for good on this device once dismissed. It replaced an
// auto-rotating carousel that competed with the plan and moved on its own.

export type TipIcon = 'trend' | 'sunscreen' | 'layers' | 'cloud' | 'reflection' | 'vitamin'

export interface SunTip {
  icon: TipIcon
  title: string
  body: string
}

export const TIPS: readonly SunTip[] = [
  {
    icon: 'trend',
    title: 'Higher UV means more risk',
    body: 'As the UV index rises, skin and eye damage can happen faster.',
  },
  {
    icon: 'sunscreen',
    title: 'Protect at UV 3+',
    body: 'Public-health guidance recommends sun protection when the UV index is 3 or higher.',
  },
  {
    icon: 'layers',
    title: 'Use layers of protection',
    body: 'Combine shade, clothing, a hat, sunglasses, and broad-spectrum sunscreen when protection is needed.',
  },
  {
    icon: 'cloud',
    title: 'Clouds are not a shield',
    body: 'UV can remain high under cloud cover, so check the UV index instead of judging by brightness.',
  },
  {
    icon: 'reflection',
    title: 'Reflections matter',
    body: 'Water, sand, snow, and other bright surfaces can increase UV exposure.',
  },
  {
    icon: 'vitamin',
    title: 'Vitamin D varies',
    body: 'Sun exposure is not a precise vitamin D dose. Ask a clinician about diet or supplements if you are concerned.',
  },
]

export const TIP_STORAGE_KEY = 'solara_tip'

interface TipState {
  /** The tip the next visit shows. */
  next: number
  hidden: boolean
}

function read(storage: Storage): TipState {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(TIP_STORAGE_KEY) ?? '{}')
    const value = (parsed ?? {}) as Partial<TipState>
    const next = Number.isInteger(value.next) && value.next! >= 0 ? value.next! : 0
    return { next: next % TIPS.length, hidden: value.hidden === true }
  } catch {
    return { next: 0, hidden: false }
  }
}

function write(storage: Storage, state: TipState): void {
  try {
    storage.setItem(TIP_STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

/**
 * The tip for this visit, or null when tips are hidden; moves the next visit on to
 * the following tip. Call once per visit.
 */
export function takeTip(storage: Storage | undefined = globalThis.localStorage): SunTip | null {
  if (!storage) return TIPS[0]!
  const state = read(storage)
  if (state.hidden) return null
  write(storage, { ...state, next: (state.next + 1) % TIPS.length })
  return TIPS[state.next]!
}

/** Hides the tip on this device. */
export function hideTips(storage: Storage | undefined = globalThis.localStorage): void {
  if (storage) write(storage, { ...read(storage), hidden: true })
}
