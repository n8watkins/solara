'use client'
import { useId } from 'react'

interface Props {
  onGetStarted: () => void
}

export default function Welcome({ onGetStarted }: Props) {
  // The scene is clipped to the rounded card, so the hills round off at the bottom
  // corners too.
  const clipId = useId()
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-8">
      <div className="w-full max-w-[480px] text-center">
        <svg
          viewBox="0 0 480 280"
          xmlns="http://www.w3.org/2000/svg"
          className="mb-6 w-full"
          role="img"
          aria-label="Sunny outdoor scene with hills, trees and a walking path"
        >
          <clipPath id={clipId}>
            <rect width="480" height="280" rx="20" />
          </clipPath>
          <g clipPath={`url(#${clipId})`}>
            <rect width="480" height="280" fill="#FEF3C7" />

            <circle cx="380" cy="70" r="50" fill="#FDE68A" />
            <circle cx="380" cy="70" r="38" fill="#FCD34D" />
            {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg, i) => {
              const r1 = 44,
                r2 = 58
              const rad = (deg * Math.PI) / 180
              const x1 = 380 + r1 * Math.cos(rad)
              const y1 = 70 + r1 * Math.sin(rad)
              const x2 = 380 + r2 * Math.cos(rad)
              const y2 = 70 + r2 * Math.sin(rad)
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#F59E0B"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              )
            })}

            <ellipse cx="80" cy="110" rx="50" ry="18" fill="#D1FAE5" opacity="0.9" />
            <ellipse cx="150" cy="100" rx="35" ry="14" fill="#A7F3D0" opacity="0.8" />

            <path d="M0 200 Q120 160 240 180 Q360 195 480 170 L480 280 L0 280 Z" fill="#6EE7B7" />
            <path d="M0 220 Q100 200 220 210 Q340 218 480 200 L480 280 L0 280 Z" fill="#34D399" />
            <path d="M0 240 Q120 230 240 235 Q360 240 480 228 L480 280 L0 280 Z" fill="#10B981" />

            <polygon points="60,200 75,155 90,200" fill="#059669" />
            <polygon points="62,200 75,160 88,200" fill="#047857" />
            <polygon points="55,200 68,168 80,200" fill="#059669" />

            <polygon points="160,185 178,130 196,185" fill="#059669" />
            <polygon points="162,185 178,135 194,185" fill="#047857" />
            <polygon points="155,185 170,145 185,185" fill="#059669" />

            <polygon points="390,190 404,148 418,190" fill="#059669" />
            <polygon points="392,190 404,152 416,190" fill="#047857" />

            <path
              d="M100 250 Q190 238 280 244 Q350 248 420 240"
              stroke="#FCD34D"
              strokeWidth="5"
              fill="none"
              strokeLinecap="round"
            />

            <ellipse cx="230" cy="238" rx="10" ry="12" fill="#FBBF24" />
            <circle cx="230" cy="222" r="7" fill="#F9A8D4" />
            <line
              x1="230"
              y1="229"
              x2="222"
              y2="242"
              stroke="#92400E"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <line
              x1="230"
              y1="229"
              x2="238"
              y2="242"
              stroke="#92400E"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <line
              x1="228"
              y1="233"
              x2="222"
              y2="239"
              stroke="#92400E"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line
              x1="232"
              y1="233"
              x2="238"
              y2="239"
              stroke="#92400E"
              strokeWidth="1.5"
              strokeLinecap="round"
            />

            <ellipse cx="310" cy="108" rx="28" ry="11" fill="white" opacity="0.7" />
            <ellipse cx="295" cy="112" rx="20" ry="9" fill="white" opacity="0.6" />
            <ellipse cx="325" cy="113" rx="16" ry="8" fill="white" opacity="0.6" />

            <ellipse cx="140" cy="145" rx="22" ry="9" fill="white" opacity="0.5" />
            <ellipse cx="128" cy="149" rx="16" ry="7" fill="white" opacity="0.5" />
          </g>
        </svg>

        <h1 className="mb-2.5 text-[28px] font-semibold text-ink">Know when to go outside</h1>
        <p className="mx-auto mb-8 max-w-[360px] text-[15px] leading-[1.6] text-ink-2">
          Solara estimates lower-UV times for running, hiking, swimming, and other outdoor
          activities based on forecast UV, your skin profile, and your plans.
        </p>

        <div className="flex justify-center">
          <button
            className="btn btn-primary rounded-xl px-8 py-3 text-[15px]"
            onClick={onGetStarted}
          >
            Get started →
          </button>
        </div>
      </div>
    </main>
  )
}
