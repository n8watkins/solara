import { plural, type Translation } from '@solara/core/i18n'
import type vitaminD from '../vitamin-d'

export default {
  title: 'Registro de vitamina D',
  lead: 'Estimaciones aproximadas de la vitamina D que tu tiempo al sol pudo producir, y de qué tan cerca estuvo cada sesión de una quemadura.',
  deviceOnly:
    'Se guarda solo en este navegador y nunca se envía a Solara. Al cerrar sesión se oculta hasta que vuelvas a iniciarla aquí.',

  today: 'Hoy',
  last7Days: 'Últimos 7 días',
  estimateLabel: 'estimación',
  aboutIu: iu => `unas ${iu} UI`,
  underFiftyIu: 'menos de 50 UI',
  noneIu: 'nada',
  comparison: (amount, olderAmount) =>
    `Como referencia, una cantidad diaria que se cita a menudo es ${amount} UI (15 mcg) para personas adultas y ${olderAmount} UI a partir de los 70 años (Academias Nacionales de EE. UU., 2011). Es una ingesta con alimentos y suplementos, no una meta de tiempo al sol.`,

  chartTitle: 'Vitamina D estimada por día, últimos 7 días',
  chartDay: 'Día',
  chartEstimate: 'Estimación',
  chartSessions: 'Sesiones',

  sessions: 'Sesiones',
  addSession: 'Agregar una sesión',
  empty:
    'Todavía no hay sesiones. Agrega una después de estar al sol, o usa «Registrar» en una actividad que ya terminó por hoy.',
  session: 'Tiempo al sol',
  sessionWhen: (day, range, length) => `${day} · ${range} · ${length}`,
  sessionEstimate: iu => `Unas ${iu} UI de vitamina D`,
  sessionEstimateUnder50: 'Menos de 50 UI de vitamina D',
  sessionEstimateNone: 'No se cuenta vitamina D',
  burnOf: (minutes, burn) => `${minutes} de un tiempo hasta quemarte de ${burn}`,
  burnNone: 'UV demasiado bajo para quemar',
  burnWellUnder: 'Muy por debajo de tu tiempo hasta quemarte',
  burnClose: 'Cerca de tu tiempo hasta quemarte',
  burnPast: 'Pasaste tu tiempo hasta quemarte: es probable que la piel se enrojezca',
  cappedNote: 'El tiempo después del tiempo hasta quemarte no suma vitamina D.',
  lowUvNote: 'Los minutos con UV menor que 1 cuentan para la quemadura, no para la vitamina D.',
  details: (skin, uv, sunscreen) => `${skin} · UV ${uv} · ${sunscreen}`,
  withSunscreen: 'con protector solar',
  noSunscreen: 'sin protector solar',
  edit: 'Editar',
  delete: 'Eliminar',
  editNamed: session => `Editar ${session}`,
  deleteNamed: session => `Eliminar ${session}`,
  deleted: 'Se eliminó la sesión.',
  undo: 'Deshacer',
  logged: name =>
    `Se registró ${name}. Revisa la hora y la piel al sol, y edítala si no coinciden.`,
  alreadyLogged: name => `${name} ya está en el registro de hoy.`,
  saveFailed:
    'No se pudo guardar en este navegador. Puede que su almacenamiento esté lleno o bloqueado.',

  exposure: 'Piel al sol',
  exposureFaceHands: 'Cara y manos',
  exposureFaceArms: 'Cara y brazos',
  exposureArmsLegs: 'Brazos y piernas',
  exposureSwimwear: 'Traje de baño',
  exposureFaceHandsHint: 'Manga larga y pantalón largo',
  exposureFaceArmsHint: 'Manga corta, pantalón largo',
  exposureArmsLegsHint: 'Camiseta y shorts',
  exposureSwimwearHint: 'Casi todo el cuerpo',

  addTitle: 'Agregar una sesión',
  editTitle: 'Editar la sesión',
  date: 'Fecha',
  startTime: 'Hora de inicio',
  length: 'Duración (minutos)',
  sunscreen: 'Usé protector solar',
  sunscreenHint: 'Sigue usándolo: el riesgo de quemadura importa más que la vitamina D.',
  uvIndex: 'Índice UV a esa hora',
  uvHint:
    'El pronóstico solo cubre hoy. Escribe el índice UV de un reporte del clima para esa hora, o tu mejor estimación.',
  uvFromForecast: uv => `UV ${uv} en promedio, según el pronóstico`,
  skinTypeNote: skin => `Para ${skin}, según Configuración, Perfil solar.`,
  preview: 'Estimación',
  save: 'Guardar sesión',
  cancel: 'Cancelar',
  invalidDate: from => `Elige un día entre el ${from} y hoy.`,
  invalidStart: 'Escribe una hora de inicio.',
  invalidLength: max => `Escribe una duración de 1 a ${max} minutos.`,
  invalidUv: max => `Escribe un índice UV de 0 a ${max}.`,

  howTitle: 'Cómo se calculan estas estimaciones',
  howModel:
    'Unas 1000 UI de vitamina D para una persona adulta con brazos y piernas descubiertos, en más o menos un tercio del tiempo que tarda la piel en enrojecer (la regla práctica habitual, Holick, 2004), la misma estimación que la tarjeta del panel. Con menos piel al sol se produce menos: cara y manos cuentan una cuarta parte, cara y brazos la mitad, y el traje de baño el doble.',
  howLowSun:
    'Un sol bajo cuenta despacio, y un UV menor que 1 no cuenta. La piel no produce más vitamina D después de más o menos una dosis de quemadura, así que el tiempo después del tiempo hasta quemarte no suma nada.',
  howSunscreen:
    'El protector solar cuenta como dividir el UV entre 2.5, como suponen los planes para FPS 30 o más, tanto para la quemadura como para la vitamina D. Como se suele aplicar, bloquea mucho menos de lo que dice su etiqueta (Neale y colaboradores, 2019).',
  howLimits:
    'No se toma en cuenta la edad: la piel de las personas mayores produce mucha menos vitamina D. Las necesidades y la producción varían mucho según la persona, la estación y el lugar donde vives. Son estimaciones aproximadas, no consejo médico; consulta a un profesional de la salud si te preocupa.',

  download: 'Descargar el registro',
  deleteAll: 'Eliminar todas las sesiones',
  confirmDeleteAll: count =>
    `¿Eliminar ${plural(count, { one: 'la sesión', other: `las ${count} sesiones` })} de este navegador? No se puede deshacer.`,
  confirmDeleteAllAction: 'Eliminar todo',
  keep: 'Conservarlas',
  deletedAll: 'Se eliminaron todas las sesiones de este navegador.',
} satisfies Translation<typeof vitaminD>

/** Health and safety wording a native speaker checks (docs/i18n/es-review.md). */
export const needsReview: (keyof typeof vitaminD)[] = [
  'lead',
  'comparison',
  'burnOf',
  'burnNone',
  'burnWellUnder',
  'burnClose',
  'burnPast',
  'cappedNote',
  'lowUvNote',
  'sunscreen',
  'sunscreenHint',
  'uvHint',
  'howModel',
  'howLowSun',
  'howSunscreen',
  'howLimits',
]
