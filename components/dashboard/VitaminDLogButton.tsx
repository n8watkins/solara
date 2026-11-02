import m from '@/messages/dashboard'

/**
 * Opens the vitamin D log (ROADMAP item 48), under the dashboard's estimate cards. It is in
 * the first load, so it stays plain; the log itself loads when opened.
 */
export default function VitaminDLogButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      data-testid="vitd-log-open"
      className="flex w-full cursor-pointer items-center gap-3 rounded-xl border-[0.5px] border-line-strong bg-surface-card px-3.5 py-2.5 text-left"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-semibold text-ink">{m.vitdLog}</span>
        <span className="text-[12px] text-ink-3">{m.vitdLogHint}</span>
      </span>
      {/* Drawn inline: an icon module here would add to every guest's first load. */}
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        aria-hidden="true"
        className="shrink-0 fill-none stroke-current stroke-2 text-ink-3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  )
}
