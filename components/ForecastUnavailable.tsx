import { CloudOff, RotateCw } from 'lucide-react'

/**
 * The dashboard when no forecast has loaded and the last request failed (REVIEW8 QA L5):
 * says so in place of the empty page, and that Solara keeps trying by itself
 * (lib/forecast-store.ts), with a button to try now.
 */
export default function ForecastUnavailable({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div
      className="card flex flex-col items-center px-6 py-10 text-center"
      data-testid="forecast-unavailable"
    >
      <CloudOff size={36} strokeWidth={1.75} className="mb-3 text-ink-3" aria-hidden="true" />
      <h2 className="mb-1.5 text-[18px] font-[650] text-ink">No forecast yet</h2>
      <p role="alert" className="mb-5 max-w-[340px] text-[14px] leading-normal text-ink-2">
        {message}
      </p>
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        <RotateCw size={15} aria-hidden="true" /> Try again now
      </button>
    </div>
  )
}
