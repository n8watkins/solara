import VisuallyHidden from './VisuallyHidden'

// Placeholder blocks, sized like the text they stand in for.
const STRONG = 'bg-line-strong'
const SOFT = 'bg-line'

/**
 * The dashboard's loading state. It mirrors the dashboard's layout (day picker,
 * hero, UV card, the two exposure metrics, Activities), so nothing jumps when
 * the forecast arrives.
 */
export default function Skeleton() {
  return (
    <div className="dash-stack animate-pulse" role="status">
      <VisuallyHidden>Loading the forecast…</VisuallyHidden>

      <div className="flex items-center justify-between gap-2" aria-hidden="true">
        <div className="flex gap-1.5">
          <div className={`h-[35px] w-[63px] rounded-[10px] ${STRONG}`} />
          <div className={`h-[35px] w-[86px] rounded-[10px] ${SOFT}`} />
          <div className={`h-[35px] w-[92px] rounded-[10px] ${SOFT}`} />
        </div>
        <div className={`size-[34px] rounded-[10px] ${SOFT}`} />
      </div>

      <div className="card space-y-3" aria-hidden="true">
        <div className={`h-3 w-36 rounded-sm ${STRONG}`} />
        <div className="flex items-center gap-3.5">
          <div className={`size-9 shrink-0 rounded-lg ${STRONG}`} />
          <div className="flex-1 space-y-2">
            <div className={`h-6 w-36 rounded-md ${STRONG}`} />
            <div className={`h-3 w-48 rounded-sm ${SOFT}`} />
          </div>
        </div>
      </div>

      <div className="card space-y-3.5" aria-hidden="true">
        <div className={`h-4 w-24 rounded-sm ${STRONG}`} />
        <div className="space-y-2">
          <div className={`h-10 w-32 rounded-lg ${STRONG}`} />
          <div className={`h-3 w-44 rounded-sm ${SOFT}`} />
        </div>
        <div className={`h-[124px] rounded-xl ${SOFT}`} />
        <div className="flex gap-1">
          {Array.from({ length: 14 }, (_, i) => (
            <div key={i} className={`h-[52px] flex-1 rounded-[10px] ${STRONG}`} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5" aria-hidden="true">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="metric-card space-y-2 px-3 py-2.5">
            <div className={`h-3 w-28 rounded-sm ${STRONG}`} />
            <div className={`h-6 w-12 rounded-sm ${STRONG}`} />
            <div className={`h-2.5 w-24 rounded-sm ${SOFT}`} />
          </div>
        ))}
      </div>

      <div className="space-y-3" aria-hidden="true">
        <div className={`h-4 w-24 rounded-sm ${STRONG}`} />
        <div className={`h-3 w-72 max-w-full rounded-sm ${SOFT}`} />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5 pt-1">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="card space-y-3">
              <div className="flex items-center gap-2">
                <div className={`size-5 rounded-sm ${STRONG}`} />
                <div className={`h-4 w-24 rounded-sm ${STRONG}`} />
                <div className={`h-5 w-12 rounded-lg ${SOFT}`} />
              </div>
              <div className={`h-24 rounded-[9px] ${SOFT}`} />
              <div className="space-y-2">
                {Array.from({ length: 4 }, (_, j) => (
                  <div key={j} className="flex justify-between">
                    <div className={`h-3 w-24 rounded-sm ${SOFT}`} />
                    <div className={`h-3 w-12 rounded-sm ${STRONG}`} />
                  </div>
                ))}
              </div>
              <div className={`h-1 rounded-full ${SOFT}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
