const LINK = 'text-inherit underline'

/**
 * Credits for the open data Solara is built on. Open-Meteo forecasts and its
 * place search, whose places come from GeoNames, are CC BY 4.0; OpenStreetMap
 * (used for "use my location" place names) is ODbL. All three licenses require
 * visible attribution with a link.
 */
export default function DataAttribution({
  className = '',
  compact = false,
}: {
  /** Layout utilities (margins, a top rule) from the caller. */
  className?: string
  /** Shorter wording for tight spaces such as the location popover. */
  compact?: boolean
}) {
  return (
    <p className={`m-0 text-[11px] leading-normal text-ink-3 ${className}`}>
      {compact ? 'Data: ' : 'Weather and place data by '}
      <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className={LINK}>
        Open-Meteo
      </a>{' '}
      and{' '}
      <a
        href="https://www.geonames.org/"
        target="_blank"
        rel="noopener noreferrer"
        className={LINK}
      >
        GeoNames
      </a>{' '}
      (
      <a
        href="https://creativecommons.org/licenses/by/4.0/"
        target="_blank"
        rel="noopener noreferrer"
        className={LINK}
      >
        CC BY 4.0
      </a>
      ),{' '}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        className={LINK}
      >
        ©&nbsp;OpenStreetMap contributors
      </a>
      .
    </p>
  )
}
