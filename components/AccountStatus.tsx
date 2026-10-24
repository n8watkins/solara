/** Shown while the signed-in account loads. */
export function AccountLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-3 text-[40px]">☀️</div>
        <p className="text-[14px] text-ink-3">Loading...</p>
      </div>
    </div>
  )
}

/** Shown when the account could not be loaded or created; nothing was changed. */
export function AccountLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-[440px] text-center">
        <div className="mb-3 text-[36px]">☁️</div>
        <h1 className="mb-2 text-[20px] font-[650] text-ink">Your account could not load</h1>
        <p role="alert" className="mb-[18px] text-[14px] leading-normal text-ink-2">
          {message}
        </p>
        <button className="btn btn-primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  )
}
