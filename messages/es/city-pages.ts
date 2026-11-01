import type { Translation } from '@solara/core/i18n'
import type cityPages from '../city-pages'
import { las } from '@solara/core/messages/es/grammar'

export default {
  months:
    'enero,febrero,marzo,abril,mayo,junio,julio,agosto,septiembre,octubre,noviembre,diciembre',
  monthsShort: 'ene,feb,mar,abr,may,jun,jul,ago,sep,oct,nov,dic',

  allYear: 'todo el año',
  inMonth: month => `en ${month}`,
  inMonths: months => `en ${months}`,
  fromMonthTo: (from, to) => `de ${from} a ${to}`,

  factPeak: (city, month, uv, label) =>
    `El UV en ${city} es más alto en ${month}, cuando un día típico llega a un máximo de alrededor de ${uv} (${label}).`,
  factHours: (month, from, to, hours) =>
    `En un día típico de ${month}, el UV es moderado o más alto desde alrededor de ${las(from)} hasta ${las(to)}, unas ${hours} horas.`,
  factAllYear:
    'El UV típico del mediodía es moderado o más alto todos los meses, así que protegerse del sol es un hábito de todo el año aquí.',
  factSeason: season =>
    `El UV típico del mediodía es moderado o más alto ${season}, cuando las autoridades de salud pública recomiendan protegerse del sol.`,
  factLow: span => `El UV suele mantenerse bajo ${span}.`,
  factClouds: (month, peak, clearSky) =>
    `Las nubes bajan más el UV en ${month}: un máximo típico de ${peak}, frente a ${clearSky} con cielo despejado. En un día despejado, espera el número más alto.`,
  factAltitude: meters =>
    `A unos ${meters} m sobre el nivel del mar, el UV aquí es más alto que en la costa: alrededor de un 10% más por cada 1000 m.`,

  title: city => `Índice UV en ${city} por mes | Solara`,
  description: (place, uv, month) =>
    `Índice UV típico en ${place} por mes: llega a cerca de ${uv} en ${month}. Mira cuándo es moderado o más alto y el pronóstico de hoy.`,
  breadcrumb: 'Ruta de navegación',
  uvByCity: 'UV por ciudad',
  heading: city => `Índice UV en ${city}`,
  typicalByMonth: 'UV típico por mes',
  todayIn: city => `Hoy en ${city}`,
  todaysUv: city => `El UV de hoy en ${city}`,
  todayBody:
    'El pronóstico por hora y los horarios con menos UV para lo que haces al aire libre. Gratis, sin necesidad de cuenta.',
  seeToday: 'Ver el UV de hoy',
  yearAtAGlance: 'El año de un vistazo',
  monthsHeading: 'UV típico por mes',
  monthsIntro: (first, last) =>
    `El índice UV más alto de un día típico, con nubes y con cielo despejado, y las horas en que el UV suele ser moderado o más alto, de ${first} a ${last}. Las categorías siguen la escala de la OMS, que redondea a números enteros, así que un máximo típico de 2.5 ya cuenta como Moderado.`,
  tableCaption: city => `Índice UV típico en ${city} por mes`,
  month: 'Mes',
  typicalPeak: 'Máximo típico',
  clearSky: 'Cielo despejado',
  moderateOrHigher: 'Moderado o más',
  rarely: 'Rara vez',
  someDays: 'Algunos días',
  aboutHeading: 'Sobre estos números',
  aboutSource: (first, last) =>
    `Promedios de todos los días de ${first} a ${last} en el modelo global de composición atmosférica del `,
  copernicus: 'Servicio de Vigilancia Atmosférica de Copernicus',
  aboutServedBy: ', servidos por la ',
  openMeteoApi: 'API de calidad del aire de Open-Meteo',
  aboutCaveat:
    ', para el centro de la ciudad, en hora local. Describen un día típico, no un día en particular: el UV de un día dado puede ser más alto o más bajo, así que revisa el pronóstico antes de salir. Solara es una ayuda para planificar, no un consejo médico.',
  otherCities: 'El UV en otras ciudades',
  allCities: 'Todas las ciudades',

  indexTitle: 'Índice UV por ciudad: UV típico por mes | Solara',
  indexDescription:
    'Índice UV típico por mes en 50 ciudades de Estados Unidos y del mundo: cuándo llega a 3 o más y cuándo se mantiene bajo.',
  indexEyebrow: 'Índice UV por mes',
  indexIntro:
    'Qué tan fuerte es el sol cada mes, con tres años de datos diarios del UV. Elige una ciudad para ver su UV típico, las horas en que llega a 3 o más y un enlace al pronóstico de hoy.',
  peaksAround: (uv, month) => `máximo de alrededor de ${uv} en ${month}`,
} satisfies Translation<typeof cityPages>

/** Safety wording a native speaker must check before release (docs/i18n/es-review.md). */
export const needsReview: (keyof typeof cityPages)[] = [
  'factHours',
  'factAllYear',
  'factSeason',
  'factLow',
  'factClouds',
  'factAltitude',
  'monthsIntro',
  'todayBody',
  'aboutCaveat',
]
