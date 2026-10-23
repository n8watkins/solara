'use client'
import { useState, useRef, useEffect } from 'react'
import type { KeyboardEvent } from 'react'

const EMOJI_GROUPS = [
  {
    label: '🏃 Active',
    emojis: [
      '🏃',
      '🚴',
      '🏊',
      '🏄',
      '🧘',
      '🤸',
      '🏋️',
      '⛹️',
      '🤾',
      '🏇',
      '🚵',
      '🤺',
      '🏌️',
      '🎿',
      '🏂',
      '🛹',
      '🧗',
      '🤼',
      '🏆',
      '🥇',
    ],
  },
  {
    label: '⚽ Sports',
    emojis: [
      '⚽',
      '🏀',
      '🏈',
      '⚾',
      '🥎',
      '🎾',
      '🏐',
      '🏉',
      '🥏',
      '🏸',
      '🏒',
      '🏑',
      '🥍',
      '🏓',
      '🥊',
      '🎯',
      '🏹',
      '🎣',
      '🤿',
    ],
  },
  {
    label: '🌿 Nature',
    emojis: [
      '🌿',
      '🌱',
      '🌲',
      '🌳',
      '🌴',
      '🌵',
      '🍀',
      '🌾',
      '🌻',
      '🌸',
      '🌺',
      '🍁',
      '🍂',
      '🍃',
      '🌊',
      '🏔️',
      '🗻',
      '🏕️',
      '🌅',
      '🌄',
    ],
  },
  {
    label: '☀️ Sun & sky',
    emojis: [
      '☀️',
      '🌤️',
      '⛅',
      '🌈',
      '🌊',
      '🏖️',
      '🏝️',
      '⛰️',
      '🌋',
      '🗺️',
      '🧭',
      '⛺',
      '🔥',
      '💧',
      '❄️',
      '🌬️',
      '🌪️',
      '🌫️',
      '🌡️',
      '⚡',
    ],
  },
  {
    label: '🐾 Animals',
    emojis: [
      '🐕',
      '🐈',
      '🐦',
      '🦅',
      '🦁',
      '🐺',
      '🦊',
      '🐻',
      '🐼',
      '🐨',
      '🦋',
      '🐝',
      '🐛',
      '🦎',
      '🐸',
      '🐬',
      '🦈',
      '🐙',
      '🦀',
      '🦜',
    ],
  },
  {
    label: '🥗 Food & drink',
    emojis: [
      '🥗',
      '🍉',
      '🍓',
      '🫐',
      '🍎',
      '🍊',
      '🍋',
      '🌽',
      '🥕',
      '🥦',
      '☕',
      '🧃',
      '💧',
      '🧊',
      '🫖',
      '🍵',
      '🥤',
      '🍹',
      '🍦',
      '🧁',
    ],
  },
  {
    label: '🎒 Gear',
    emojis: [
      '🎒',
      '👟',
      '🧢',
      '🕶️',
      '🧣',
      '🧤',
      '🧦',
      '👗',
      '🩱',
      '🩲',
      '🩳',
      '👒',
      '⛑️',
      '🌂',
      '☂️',
      '🔦',
      '🧴',
      '💊',
      '🩺',
      '🏷️',
    ],
  },
  {
    label: '✨ Other',
    emojis: [
      '✨',
      '⭐',
      '🌟',
      '💫',
      '🔥',
      '💥',
      '🎉',
      '🎊',
      '🎈',
      '🎁',
      '💪',
      '🙌',
      '👋',
      '✌️',
      '🤙',
      '👏',
      '🙏',
      '💚',
      '🧡',
      '❤️',
    ],
  },
]

interface Props {
  id?: string
  value: string
  onChange: (emoji: string) => void
  onClose: () => void
}

/**
 * A non-modal icon picker. Keyboard: the search box, then one tab stop for
 * the grid, where arrow keys move between emojis (Home and End jump);
 * Escape closes and returns focus to the button that opened it, and tabbing
 * out closes it too.
 */
export default function EmojiPicker({ id, value, onChange, onClose }: Props) {
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  // The element focused when the picker opened, captured before the search
  // box takes focus, so closing can hand focus back to it.
  const [opener] = useState(() =>
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  )

  useEffect(() => {
    function handle(e: MouseEvent) {
      const target = e.target as Node
      // The opener toggles the picker itself; closing here too would reopen it.
      if (ref.current?.contains(target) || opener?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose, opener])

  function closeAndReturnFocus() {
    onClose()
    opener?.focus()
  }

  function pick(emoji: string) {
    onChange(emoji)
    closeAndReturnFocus()
  }

  const all = EMOJI_GROUPS.flatMap(g => g.emojis)
  const filtered = search ? all.filter(e => e.includes(search)) : null
  const visible = filtered ?? all
  // Roving tab stop: the selected emoji if it is shown, else the first one.
  const tabStop = visible.includes(value) ? visible.indexOf(value) : 0
  let index = 0

  function buttons() {
    return Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = buttons()
    const current = list.indexOf(document.activeElement as HTMLButtonElement)
    if (current < 0) return
    let next: number | null = null
    if (event.key === 'ArrowRight') next = Math.min(list.length - 1, current + 1)
    else if (event.key === 'ArrowLeft') next = Math.max(0, current - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = list.length - 1
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Rows differ in length across groups, so move by geometry: the
      // nearest button by horizontal position in the next or previous row.
      const from = list[current]!.getBoundingClientRect()
      const down = event.key === 'ArrowDown'
      const rows = list
        .map((button, i) => ({ i, rect: button.getBoundingClientRect() }))
        .filter(({ rect }) => (down ? rect.top > from.top + 4 : rect.top < from.top - 4))
      if (rows.length) {
        const rowTop = down
          ? Math.min(...rows.map(r => r.rect.top))
          : Math.max(...rows.map(r => r.rect.top))
        const row = rows.filter(r => Math.abs(r.rect.top - rowTop) < 4)
        row.sort((a, b) => Math.abs(a.rect.left - from.left) - Math.abs(b.rect.left - from.left))
        next = row[0]!.i
      }
    }
    if (next === null) return
    event.preventDefault()
    const target = list[next]
    target?.focus()
    target?.scrollIntoView({ block: 'nearest' })
  }

  function renderButton(e: string, key: string) {
    const i = index++
    return (
      <EmojiBtn
        key={key}
        e={e}
        selected={value === e}
        tabIndex={i === tabStop ? 0 : -1}
        onClick={() => pick(e)}
      />
    )
  }

  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label="Choose an icon"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          // Close only the picker, not the dialog it sits in.
          event.preventDefault()
          event.stopPropagation()
          closeAndReturnFocus()
        }
      }}
      onBlur={event => {
        const next = event.relatedTarget as Node | null
        if (!ref.current?.contains(next) && !opener?.contains(next)) onClose()
      }}
      style={{
        position: 'absolute',
        top: '110%',
        left: 0,
        zIndex: 100,
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border-md)',
        borderRadius: '14px',
        width: '280px',
        maxHeight: '300px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
      }}
    >
      <div style={{ padding: '8px 10px', borderBottom: '0.5px solid var(--border-md)' }}>
        <input
          autoFocus
          type="search"
          aria-label="Search emojis"
          placeholder="Search emojis..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', fontSize: '13px', padding: '6px 10px' }}
        />
      </div>
      <div
        ref={gridRef}
        onKeyDown={handleGridKeyDown}
        style={{ overflowY: 'auto', flex: 1, padding: '8px 10px' }}
      >
        {filtered ? (
          <div
            role="group"
            aria-label="Search results"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}
          >
            {filtered.map((e, i) => renderButton(e, `search-${i}`))}
          </div>
        ) : (
          EMOJI_GROUPS.map(g => (
            <div key={g.label} style={{ marginBottom: '10px' }}>
              <p
                aria-hidden="true"
                style={{
                  margin: '0 0 4px',
                  fontSize: '11px',
                  color: 'var(--text-3)',
                  fontWeight: 500,
                }}
              >
                {g.label}
              </p>
              <div
                role="group"
                aria-label={g.label.replace(/^\S+\s/, '')}
                style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}
              >
                {g.emojis.map((e, i) => renderButton(e, `${g.label}-${i}`))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function EmojiBtn({
  e,
  selected,
  tabIndex,
  onClick,
}: {
  e: string
  selected: boolean
  tabIndex: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      tabIndex={tabIndex}
      style={{
        width: '32px',
        height: '32px',
        fontSize: '18px',
        borderRadius: '6px',
        cursor: 'pointer',
        border: selected ? '1.5px solid var(--accent)' : 'none',
        background: selected ? 'rgba(249,115,22,0.1)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-metric)')}
      onMouseLeave={e =>
        (e.currentTarget.style.background = selected ? 'rgba(249,115,22,0.1)' : 'transparent')
      }
    >
      {e}
    </button>
  )
}
