import type { Translation } from '../../i18n'
import type core from '../core'
import { las, punto } from './grammar'

const NBSP = '\u00a0'

export default {
  uvLow: 'Bajo',
  uvModerate: 'Moderado',
  uvHigh: 'Alto',
  uvVeryHigh: 'Muy alto',
  uvExtreme: 'Extremo',

  minutes: m => `${m}\u00a0min`,
  hours: h => `${h}\u00a0h`,
  hoursMinutes: (h, m) => `${h}\u00a0h ${m}\u00a0min`,

  clock12: (time, pm) => `${time}${NBSP}${pm ? 'p.m.' : 'a.m.'}`,
  clock12Compact: (hour, pm) => `${hour}${pm ? 'p' : 'a'}`,

  weekdaysShort: 'dom,lun,mar,mié,jue,vie,sáb',
  weekdays: 'Entre semana',
  weekends: 'Fines de semana',
  listOr: items =>
    items.length <= 1
      ? items.join('')
      : `${items.slice(0, -1).join(', ')} ${/^h?o/i.test(items.at(-1) ?? '') ? 'u' : 'o'} ${items.at(-1)}`,
  listAnd: items =>
    items.length <= 1
      ? items.join('')
      : `${items.slice(0, -1).join(', ')} ${/^h?i(?!e)/i.test(items.at(-1) ?? '') ? 'e' : 'y'} ${items.at(-1)}`,

  rainLikely: range => `Probable lluvia ${range}`,
  tooHot: (range, feels) => `Demasiado calor ${range}, sensación de ${feels}`,

  confidenceFair: 'Confianza media: el UV y las mejores horas aún pueden cambiar',
  confidenceLow: 'Confianza baja: es una guía aproximada, vuelve a revisar más cerca del día',
  cloudNote: (uv, clearSky) =>
    `Las nubes podrían bajar el UV a ${uv}, frente a ${clearSky} con cielo despejado`,

  stripNoForecast: 'No hay pronóstico UV para este día.',
  stripPeak: (uv, label, time) =>
    punto(`El UV llega a su máximo de ${uv}, ${label}, a ${las(time)}`),
  stripHighAt: time => punto(`Alto o más a ${las(time)}`),
  stripHighFromTo: (from, to) => punto(`Alto o más de ${from} a ${to}`),
  stripNoDataAt: time => punto(`Sin datos de UV a ${las(time)}`),
  stripNoDataFromTo: (from, to) => punto(`Sin datos de UV de ${from} a ${to}`),

  today: 'Hoy',
  tomorrow: 'Mañana',
  todayLower: 'hoy',
  tomorrowLower: 'mañana',
  onDate: date => `el ${date}`,
  timeTomorrow: time => `${time} de mañana`,
  yesterdayAt: time => `ayer, ${time}`,
  dateAt: (date, time) => `${date}, ${time}`,

  conditionClear: 'Despejado',
  conditionPartlyCloudy: 'Parcialmente nublado',
  conditionFoggy: 'Neblina',
  conditionRainy: 'Lluvia',
  conditionSnowy: 'Nieve',
  conditionShowers: 'Chubascos',
  conditionStormy: 'Tormenta',
  conditionUnknown: 'Desconocido',

  windowMorning: 'Mañana',
  windowMidday: 'Mediodía',
  windowAfternoon: 'Tarde',
  windowEvening: 'Atardecer',
  windowAllDay: 'Todo el día',

  skinVeryFair: 'muy clara',
  skinFair: 'clara',
  skinMedium: 'media',
  skinOlive: 'oliva',
  skinDark: 'oscura',
  skinOf: name => `piel ${name}`,

  defaultActivityName: 'Actividad al aire libre',
  newerSettings: schema =>
    `Esta configuración se guardó con una versión más reciente de Solara (esquema ${schema}). Recarga para actualizar antes de cambiarla.`,
  windowEventTitle: activity => `${activity}: horario de UV más bajo`,
  icsCalendarName: 'Plan solar de Solara',

  reasonLatest: part => `El último espacio que encaja en tu horario de ${part}`,
  reasonSunniest: 'Tu horario disponible más soleado dentro del límite que planificaste',
  reasonEarliest: part => `El primer espacio libre en tu horario de ${part}`,
  reasonAllDayPart: 'UV más bajo',
} satisfies Translation<typeof core>

/** Safety wording a native speaker must check before release (docs/i18n/es-review.md). */
export const needsReview: (keyof typeof core)[] = [
  'uvLow',
  'uvModerate',
  'uvHigh',
  'uvVeryHigh',
  'uvExtreme',
  'confidenceFair',
  'confidenceLow',
  'cloudNote',
]
