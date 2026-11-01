import type { UVBand } from '@/lib/weather'
import { UV_BG } from './uv-classes'
import core from '@solara/core/messages/core'

const BANDS: Array<[UVBand, () => string]> = [
  ['low', () => `${core.uvLow} (0–2)`],
  ['moderate', () => `${core.uvModerate} (3–5)`],
  ['high', () => `${core.uvHigh} (6–7)`],
  ['very-high', () => `${core.uvVeryHigh} (8–10)`],
  ['extreme', () => `${core.uvExtreme} (11+)`],
]

/** The color and range of each UV band, shown when "UV scale" is opened. */
export default function UVScaleBands() {
  return (
    <div className="mt-1 flex flex-wrap gap-x-3.5 gap-y-1.5">
      {BANDS.map(([band, label]) => (
        <span key={band} className="inline-flex items-center gap-[5px] text-[12px] text-ink-3">
          <span className={`size-2.5 shrink-0 rounded-[3px] ${UV_BG[band]}`} />
          {label()}
        </span>
      ))}
    </div>
  )
}
