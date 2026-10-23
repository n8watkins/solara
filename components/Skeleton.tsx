export default function Skeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-4 w-36 bg-line-strong rounded-lg" />
          <div className="h-3 w-24 bg-line rounded-lg" />
        </div>
        <div className="h-8 w-32 bg-line rounded-xl" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="metric-card space-y-2">
            <div className="h-3 w-16 bg-line-strong rounded-sm" />
            <div className="h-7 w-12 bg-line-strong rounded-sm" />
            <div className="h-3 w-20 bg-line rounded-sm" />
          </div>
        ))}
      </div>

      <div className="card space-y-3">
        <div className="flex justify-between">
          <div className="h-4 w-24 bg-line-strong rounded-sm" />
          <div className="h-4 w-20 bg-line rounded-sm" />
        </div>
        <div className="flex gap-1">
          {[...Array(14)].map((_, i) => (
            <div key={i} className="flex-1 h-12 bg-line-strong rounded-md" />
          ))}
        </div>
      </div>

      <div>
        <div className="h-4 w-20 bg-line-strong rounded-sm mb-3" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-line-strong rounded-sm" />
                <div className="flex-1 h-4 bg-line-strong rounded-sm" />
                <div className="w-16 h-5 bg-line rounded-lg" />
              </div>
              <div className="space-y-2">
                {[...Array(4)].map((_, j) => (
                  <div key={j} className="flex justify-between">
                    <div className="h-3 w-20 bg-line rounded-sm" />
                    <div className="h-3 w-12 bg-line-strong rounded-sm" />
                  </div>
                ))}
              </div>
              <div className="h-1.5 bg-line rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
