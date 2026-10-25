/**
 * Solara's sun mark, drawn as SVG so it looks the same on every platform (the
 * sun emoji it replaces renders differently on each). Decorative: the wordmark
 * or a label beside it names the app.
 */
export default function SolaraMark({
  size = 22,
  className,
}: {
  size?: number
  className?: string
}) {
  const rays = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
    >
      <circle cx="12" cy="12" r="5" fill="var(--brand)" />
      {rays.map(angle => (
        <line
          key={angle}
          x1={12 + Math.cos(angle) * 7.6}
          y1={12 + Math.sin(angle) * 7.6}
          x2={12 + Math.cos(angle) * 10.4}
          y2={12 + Math.sin(angle) * 10.4}
          stroke="var(--brand)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
    </svg>
  )
}
