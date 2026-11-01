import { ChevronRight, NotebookPen } from 'lucide-react'
import m from '@/messages/dashboard'

/** Opens the vitamin D log (ROADMAP item 48), under the dashboard's estimate cards. */
export default function VitaminDLogButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      data-testid="vitd-log-open"
      className="flex w-full cursor-pointer items-center gap-3 rounded-xl border-[0.5px] border-line-strong bg-surface-card px-3.5 py-2.5 text-left"
    >
      <NotebookPen size={18} aria-hidden="true" className="shrink-0 text-accent" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-semibold text-ink">{m.vitdLog}</span>
        <span className="text-[12px] text-ink-3">{m.vitdLogHint}</span>
      </span>
      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-3" />
    </button>
  )
}
