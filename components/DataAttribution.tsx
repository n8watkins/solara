import type { CSSProperties } from 'react'

/**
 * Credits for the open data Solara is built on. Open-Meteo forecasts and place
 * search are CC BY 4.0 and OpenStreetMap (used for "use my location" place
 * names) is ODbL; both licenses require visible attribution with a link.
 */
export default function DataAttribution({
  style,
  compact = false,
}: {
  style?: CSSProperties
  /** Shorter wording for tight spaces such as the location popover. */
  compact?: boolean
}) {
  const link: CSSProperties = { color: 'inherit', textDecoration: 'underline' }
  return (
    <p style={{ margin: 0, fontSize: '11px', lineHeight: 1.5, color: 'var(--text-3)', ...style }}>
      {compact ? 'Data: ' : 'Weather and place data by '}
      <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" style={link}>
        Open-Meteo
      </a>{' '}
      (
      <a
        href="https://creativecommons.org/licenses/by/4.0/"
        target="_blank"
        rel="noopener noreferrer"
        style={link}
      >
        CC BY 4.0
      </a>
      ) and{' '}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        style={link}
      >
        ©&nbsp;OpenStreetMap contributors
      </a>
      .
    </p>
  )
}
