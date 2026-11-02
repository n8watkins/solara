import type { Translation } from '../../i18n'
import type briefing from '../briefing'
import { las } from './grammar'

const NBSP = '\u00a0'

export default {
  peaks: (uv, label, time) => `El UV llega a su máximo de ${uv} (${label}) hacia ${las(time)}`,
  peaked: (uv, label, time) => `El UV llegó a su máximo de ${uv} (${label}) hacia ${las(time)}`,
  ifSkyClears: (peakLine, uv) => `${peakLine}, o ${uv} si el cielo se despeja`,
  nearZero: 'El UV se mantiene cerca de cero',
  fromTo: (from, to) => `de${NBSP}${from}${NBSP}a${NBSP}${to}`,
  andTo: (from, to) => `de${NBSP}${from}${NBSP}a${NBSP}${to}`,
  spansJoin: ' y ',
  untilTime: time => `hasta${NBSP}${las(time).replace(' ', NBSP)}`,
  yourActivities: 'tus actividades',
  lowestWindow: (activity, range) => `horario de UV más bajo: ${activity} ${range}`,
  noWindow: (who, left) => `no ${left ? 'queda' : 'hay'} un horario de UV más bajo para ${who}`,
  noWindowRain: (who, left) =>
    `no ${left ? 'queda' : 'hay'} un horario de UV más bajo para ${who} sin lluvia`,
  noWindowHeat: (who, left) =>
    `no ${left ? 'queda' : 'hay'} un horario de UV más bajo para ${who} sin el calor`,
  restOfDay: 'el resto del día',
  allDay: 'todo el día',
  orHigher: band => `${band} o más`,
  orBand: (band, next) => `${band} o ${next}`,
  staysBand: (band, rest) => `El UV se mantiene ${band} ${rest}`,
  staysBandUnlessClear: (band, rest) =>
    `El UV se mantiene ${band} ${rest}, salvo que el cielo se despeje`,
  isBandDuring: (band, spans) => `El UV es ${band} ${spans}`,
  fitSunscreen: (activity, spf, every) =>
    `${activity} necesita protector solar para quedar bien dentro de tu tiempo hasta quemarte: FPS${NBSP}${spf}+${every ? `, reaplicado cada ${every}` : ''}`,
  fitTooLong: (activity, spf) =>
    `${activity} dura demasiado para tu piel aun con FPS${NBSP}${spf}+: divídelo en sesiones más cortas o planifícalo para un UV más bajo`,
  burn: minutes =>
    `en el máximo, una piel como la tuya sin protección puede quemarse en unos ${minutes}\u00a0min`,
  seekShade: (bands, during, protect) =>
    `busca la sombra mientras el UV sea ${bands}, ${during}; usa sombrero, lentes de sol y protector solar ${protect}`,
  seekShadeIfClear: (during, bands, protect) =>
    `busca la sombra ${during}, porque el UV puede ser ${bands} si el cielo se despeja; usa sombrero, lentes de sol y protector solar ${protect}`,
  protect: (bands, during) =>
    `usa sombrero, lentes de sol y protector solar mientras el UV sea ${bands}, ${during}`,
  protectIfClear: (during, bands) =>
    `usa sombrero, lentes de sol y protector solar ${during}, porque el UV puede ser ${bands} si el cielo se despeja`,
  lowRestOfDay: 'El UV se mantiene bajo el resto del día',
  littleProtection: 'hoy la mayoría de las personas necesita poca protección solar',
  paragraphStart: (dayLabel, peakLine) => `${dayLabel}: ${peakLine}`,
} satisfies Translation<typeof briefing>

export const needsReview: (keyof typeof briefing)[] = [
  'peaks',
  'peaked',
  'ifSkyClears',
  'nearZero',
  'staysBand',
  'staysBandUnlessClear',
  'isBandDuring',
  'burn',
  'fitSunscreen',
  'fitTooLong',
  'seekShade',
  'seekShadeIfClear',
  'protect',
  'protectIfClear',
  'lowRestOfDay',
  'littleProtection',
]
