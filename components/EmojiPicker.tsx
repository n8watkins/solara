'use client'
import { useState, useRef, useEffect } from 'react'
import type { KeyboardEvent } from 'react'
import clsx from 'clsx'
import { EMOJI_GROUPS, searchEmojis } from '@/lib/emoji-catalog'
import { nearestInAdjacentRow, nextIndex } from '@/lib/roving-focus'

/** Eight equal columns that fill the picker's width. */
const GRID = 'grid grid-cols-8 gap-0.5'

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

  const filtered = search.trim() ? searchEmojis(search) : null
  const visible = filtered ?? EMOJI_GROUPS.flatMap(g => g.emojis.map(([e]) => e))
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
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowUp'
        ? // Rows differ in length across groups, so move by geometry.
          nearestInAdjacentRow(
            list.map(button => button.getBoundingClientRect()),
            current,
            event.key === 'ArrowDown',
          )
        : nextIndex(event.key, current, list.length, { wrap: false })
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
      className="absolute top-[110%] left-0 z-[100] flex max-h-[300px] w-[296px] flex-col overflow-hidden rounded-[14px] border-[0.5px] border-line-strong bg-surface-card shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
    >
      <div className="border-b-[0.5px] border-line-strong px-2.5 py-2">
        <input
          autoFocus
          type="search"
          aria-label="Search emojis"
          placeholder="Search emojis..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-2.5 py-1.5 text-[13px]"
        />
      </div>
      <div
        ref={gridRef}
        onKeyDown={handleGridKeyDown}
        className="flex-1 overflow-y-auto px-2.5 py-2"
      >
        {/* Always mounted, so screen readers announce when a search finds nothing. */}
        <div role="status" className="contents">
          {filtered?.length === 0 && (
            <p className="py-1 text-[13px] text-ink-3">{`No icons match "${search.trim()}".`}</p>
          )}
        </div>
        {filtered ? (
          <div role="group" aria-label="Search results" className={GRID}>
            {filtered.map((e, i) => renderButton(e, `search-${i}`))}
          </div>
        ) : (
          EMOJI_GROUPS.map(g => (
            <div key={g.name} className="mb-2.5">
              <p aria-hidden="true" className="mb-1 text-[11px] font-medium text-ink-3">
                {g.icon} {g.name}
              </p>
              <div role="group" aria-label={g.name} className={GRID}>
                {g.emojis.map(([e], i) => renderButton(e, `${g.name}-${i}`))}
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
      className={clsx(
        'flex h-8 items-center justify-center rounded-md text-[18px] transition-colors duration-100 hover:bg-surface-metric',
        selected && 'border-[1.5px] border-accent bg-accent-soft',
      )}
    >
      {e}
    </button>
  )
}
