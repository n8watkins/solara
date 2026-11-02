import { plural, type Translation } from '../../i18n'
import type server from '../server'
import { las, punto } from './grammar'

export default {
  yourArea: 'tu zona',
  recheck: 'Vuelve a revisar las condiciones actuales.',

  morningDay: city => `Hoy en ${city}`,
  morningTitle: city => `☀️ El UV hoy en ${city}`,
  morningWindowTitle: (icon, activity, from, to) => `${icon} ${activity}: de ${from} a ${to}`,

  uvSoonTitle: (threshold, time) => `☀️ El UV llega a ${threshold} hacia ${las(time)}`,
  uvNowTitle: threshold => `☀️ El UV ya está en ${threshold} o más`,
  uvBody: (place, threshold, to, peak, peakTime) =>
    `Pronóstico para ${place}: UV de ${threshold} o más hasta cerca de ${las(to)}, con un máximo de ${peak} hacia ${las(peakTime)}. Planifica sombra y protección solar, y vuelve a revisar las condiciones actuales.`,

  dailyFromTo: (from, to) => `☀️ Protégete hoy de ${from} a ${to}`,
  dailyUntil: to => `☀️ Protégete hoy hasta ${las(to)}`,
  dailyPeak: (uv, label, time, place) =>
    `El UV llega a su máximo de ${uv} (${label}) hacia ${las(time)} en ${place}.`,
  dailyPeakIfClear: (uv, label, time, place, clearSky) =>
    `El UV llega a su máximo de ${uv} (${label}) hacia ${las(time)} en ${place}, o ${clearSky} si el cielo se despeja.`,
  dailyTip:
    'Protector solar, sombrero, lentes de sol y sombra mientras el UV sea moderado o más alto.',
  dailyTipIfClear: 'Protector solar, sombrero, lentes de sol y sombra por si el cielo se despeja.',

  eventSoon: 'tu próximo evento',
  eventTomorrowAt: time => `tu evento de mañana a ${las(time)}`,
  eventAt: time => `tu evento de ${las(time)}`,
  eventTitle: (uv, event) => `🗓️ UV de hasta ${uv} durante ${event}`,
  eventName: name => `Evento: “${name}”.`,
  eventPeak: (uv, time) => punto(`El UV llega a su máximo de ${uv} hacia ${las(time)}`),
  eventPeakAt: (place, uv, time) =>
    punto(`Pronóstico para ${place}: el UV llega a su máximo de ${uv} hacia ${las(time)}`),
  eventAdvice:
    'Aplica protector solar de 15 a 30 minutos antes de salir, vuelve a aplicarlo cada 2 horas y planifica dónde tener sombra.',
  eventHot: feelsLike =>
    `La sensación térmica podría llegar a ${feelsLike}: lleva agua y toma descansos.`,
  eventMore: count =>
    plural(count, {
      one: 'Otro de tus próximos eventos también tendrá un UV alto.',
      other: `Otros ${count} de tus próximos eventos también tendrán un UV alto.`,
    }),

  feedDescription: (from, to, uv, sunscreen) =>
    `Horario estimado de UV más bajo ${from}–${to} (UV promedio ${uv})${sunscreen ? ', suponiendo FPS 30+' : ', sin protector solar'}. Es solo una estimación basada en el pronóstico. Vuelve a revisar el UV actual y protégete del sol. Planificado por Solara.`,
} satisfies Translation<typeof server>

/** Safety wording a native speaker must check before release (docs/i18n/es-review.md). */
export const needsReview: (keyof typeof server)[] = [
  'recheck',
  'uvBody',
  'dailyFromTo',
  'dailyUntil',
  'dailyPeak',
  'dailyPeakIfClear',
  'dailyTip',
  'dailyTipIfClear',
  'eventPeak',
  'eventPeakAt',
  'eventAdvice',
  'eventHot',
  'feedDescription',
]
