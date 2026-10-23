'use client'
import { useState, useRef, useEffect } from 'react'

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
      '🏸',
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
  value: string
  onChange: (emoji: string) => void
  onClose: () => void
}

export default function EmojiPicker({ value, onChange, onClose }: Props) {
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  const all = EMOJI_GROUPS.flatMap(g => g.emojis)
  const filtered = search ? all.filter(e => e.includes(search)) : null

  return (
    <div
      ref={ref}
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
          placeholder="Search emojis..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', fontSize: '13px', padding: '6px 10px' }}
        />
      </div>
      <div style={{ overflowY: 'auto', flex: 1, padding: '8px 10px' }}>
        {filtered ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
            {filtered.map((e, i) => (
              <EmojiBtn
                key={`search-${i}`}
                e={e}
                selected={value === e}
                onClick={() => {
                  onChange(e)
                  onClose()
                }}
              />
            ))}
          </div>
        ) : (
          EMOJI_GROUPS.map(g => (
            <div key={g.label} style={{ marginBottom: '10px' }}>
              <p
                style={{
                  margin: '0 0 4px',
                  fontSize: '11px',
                  color: 'var(--text-3)',
                  fontWeight: 500,
                }}
              >
                {g.label}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                {g.emojis.map((e, i) => (
                  <EmojiBtn
                    key={`${g.label}-${i}`}
                    e={e}
                    selected={value === e}
                    onClick={() => {
                      onChange(e)
                      onClose()
                    }}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function EmojiBtn({ e, selected, onClick }: { e: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
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
