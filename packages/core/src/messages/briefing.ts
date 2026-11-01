// The daily briefing's sentences (briefing.ts), each without a final period and in lower
// case where a sentence may continue them; the briefing capitalizes and joins them.
import { defineMessages } from '../i18n'

const NBSP = '\u00a0'

export default defineMessages('briefing', {
  peaks: (uv: string, label: string, time: string) => `UV peaks at ${uv} (${label}) around ${time}`,
  peaked: (uv: string, label: string, time: string) =>
    `UV peaked at ${uv} (${label}) around ${time}`,
  ifSkyClears: (peakLine: string, uv: string) => `${peakLine}, or ${uv} if the sky clears`,
  nearZero: 'UV stays near zero',
  /** A span that never breaks inside: "from 5pm to 8pm". */
  fromTo: (from: string, to: string) => `from ${from}${NBSP}to${NBSP}${to}`,
  /** The later spans of a list: "11am to 5pm" after the first "from". */
  andTo: (from: string, to: string) => `${from}${NBSP}to${NBSP}${to}`,
  spansJoin: ' and ',
  untilTime: (time: string) => `until${NBSP}${time}`,
  yourActivities: 'your activities',
  lowestWindow: (activity: string, range: string) => `lowest-UV window: ${activity} ${range}`,
  noWindow: (who: string, left: boolean) => `no lower-UV window ${left ? 'left ' : ''}for ${who}`,
  noWindowRain: (who: string, left: boolean) =>
    `no lower-UV window ${left ? 'left ' : ''}for ${who} without rain`,
  noWindowHeat: (who: string, left: boolean) =>
    `no lower-UV window ${left ? 'left ' : ''}for ${who} without the heat`,
  /** "the rest of the day" once today is under way, else "all day". */
  restOfDay: 'the rest of the day',
  allDay: 'all day',
  /** A band name and the next one up: "moderate or higher". */
  orHigher: (band: string) => `${band} or higher`,
  /** Two bands: "very high or extreme". */
  orBand: (band: string, next: string) => `${band} or ${next}`,
  staysBand: (band: string, rest: string) => `UV stays ${band} ${rest}`,
  staysBandUnlessClear: (band: string, rest: string) =>
    `UV stays ${band} ${rest} unless the sky clears`,
  isBandDuring: (band: string, spans: string) => `UV is ${band} ${spans}`,
  outlastsBurn: (activity: string) =>
    `${activity} lasts longer than your burn time at its UV limit: wear sunscreen, or plan it for a lower UV`,
  burn: (minutes: number) =>
    `at the peak, unprotected skin like yours can burn in about ${minutes}\u00a0min`,
  seekShade: (bands: string, during: string) => `seek shade while UV is ${bands}, ${during}`,
  seekShadeIfClear: (during: string, bands: string) =>
    `seek shade ${during}, as UV can be ${bands} if the sky clears`,
  protect: (bands: string, during: string) => `use sun protection while UV is ${bands}, ${during}`,
  protectIfClear: (during: string, bands: string) =>
    `use sun protection ${during}, as UV can be ${bands} if the sky clears`,
  lowRestOfDay: 'UV stays low for the rest of the day',
  littleProtection: 'most people need little sun protection today',
  /** The share and notification paragraph: "Today: UV peaks at ...". */
  paragraphStart: (dayLabel: string, peakLine: string) => `${dayLabel}: ${peakLine}`,
})
