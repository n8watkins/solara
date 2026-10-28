import type { UVBand } from '@/lib/weather'
import { UV_BG } from './uv-classes'

const BANDS: Array<[UVBand, string]> = [
  ['low', 'Low (0–2)'],
  ['moderate', 'Moderate (3–5)'],
  ['high', 'High (6–7)'],
  ['very-high', 'Very high (8–10)'],
  ['extreme', 'Extreme (11+)'],
]

/** The color and range of each UV band, shown when "UV scale" is opened. */
export default function UVScaleBands() {
  return (
    <div className="mt-1 flex flex-wrap gap-x-3.5 gap-y-1.5">
      {BANDS.map(([band, label]) => (
        <span key={band} className="inline-flex items-center gap-[5px] text-[12px] text-ink-3">
          <span className={`size-2.5 shrink-0 rounded-[3px] ${UV_BG[band]}`} />
          {label}
        </span>
      ))}
    </div>
  )
}
