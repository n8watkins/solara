import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { UVScaleBands } from '../deferred'

/** "UV scale" disclosure under the strip: the color of each band, loaded when opened. */
export default function UVScaleLegend() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(s => !s)}
        className="inline-flex cursor-pointer items-center gap-[5px] border-0 bg-transparent px-0.5 pt-1.5 pb-1 text-[11px] font-semibold text-ink-3"
        aria-expanded={open}
      >
        UV scale
        <ChevronDown
          size={14}
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <UVScaleBands />}
    </>
  )
}
