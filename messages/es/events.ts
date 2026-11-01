import { plural, type Translation } from '@solara/core/i18n'
import { las, punto } from '@solara/core/messages/es/grammar'
import type events from '../events'

const eventos = (n: number) => `${n} ${plural(n, { one: 'evento', other: 'eventos' })}`

export default {
  readingFile: 'Leyendo el archivo…',
  couldNotSaveChange: 'No se pudo guardar ese cambio. Vuelve a intentarlo.',
  couldNotRemove: 'No se pudo quitar. Vuelve a intentarlo.',
  removingEvents: 'Quitando tus eventos…',
  removedAllImported: 'Se quitaron todos los eventos importados.',
  couldNotRemoveAll: 'No se pudieron quitar todos los eventos. Vuelve a intentarlo.',
  events: 'Eventos',
  importIcs: 'Importar .ics',
  fileToImport: 'Archivo de calendario para importar',
  couldNotLoad: 'No se pudieron cargar tus eventos. Revisa tu conexión.',
  noUpcoming:
    'Todavía no hay eventos próximos. En Meetup, Eventbrite, la página de una carrera o tu calendario, usa “Agregar al calendario” o “Exportar” para descargar un archivo .ics y luego impórtalo aquí.',
  upcomingEvents: 'Próximos eventos',
  removeAllConfirm: '¿Quitar todos los eventos importados?',
  remove: 'Quitar',
  keep: 'Conservar',
  removeImported: 'Quitar eventos importados',
  refreshNote:
    'Los eventos se actualizan mientras Solara está abierta: solos durante una hora después de conectar o actualizar; si no, cuando tocas Actualizar.',
  seePro: 'Ver Pro',
  untitled: 'Evento sin título',
  couldNotSavePlace: 'No se pudo guardar el lugar. Vuelve a intentarlo.',
  fromLinked: 'De un calendario vinculado',
  loadingForecast: 'Cargando el pronóstico…',
  seeItNowPro: 'Míralo ahora con Pro',
  setPlace: 'Indicar el lugar',
  searchCity: 'Busca una ciudad…',
  cancel: 'Cancelar',
  countsAs: 'Cuenta como',
  noActivity: 'Ninguna actividad (pleno sol)',
  changePlace: 'Cambiar el lugar',
  eventPage: 'Página del evento',
  whereIsCalendar: '¿Dónde está el calendario?',
  howToCopy: 'Cómo copiar el enlace desde',
  linkedCalendars: 'calendarios vinculados',
  googleCalendar: 'Google Calendar',
  outlook: 'Outlook',
  placeSetFor: (city, n) => punto(`Lugar cambiado a ${city} en ${eventos(n)}`),
  placeSet: city => `Lugar cambiado a ${city}.`,
  eventsLead: sources => `El UV durante los eventos a los que piensas ir, ${sources}.`,
  removedEvent: title => `Se quitó ${title}.`,
  theEvent: 'el evento',
  showFewer: 'Mostrar menos',
  showAll: n => `Mostrar los ${n} eventos`,
  keptStay: sources => `Los eventos de ${sources} se quedan; quítalos con su calendario más abajo.`,
  proSendsHeadsUp: rule =>
    `Pro envía un aviso ${rule}, a los dispositivos donde activaste las alertas. Cámbialo en Configuración.`,
  proAddsLinked:
    'Pro agrega calendarios vinculados y un aviso unas horas antes de un evento al aire libre con UV alto.',
  withProHeadsUp:
    'Con Pro, recibe un aviso unas horas antes de un evento al aire libre con UV alto.',
  keptDataLinked:
    'Solo se guardan el título, la hora y el lugar de cada evento, y el enlace que da un archivo de calendario o un calendario vinculado, y solo hasta 30 días después de que termine.',
  keptData:
    'Solo se guardan el título, la hora, el lugar y el enlace de cada evento, y solo hasta 30 días después de que termine.',
  sourceFile: 'un archivo de calendario (.ics)',
  sourceLink: 'un enlace de calendario',
  fromSources: sources => `desde ${sources}`,
  usingPlace: place => `Se usa ${place}`,
  fromGoogle: 'De Google Calendar',
  fromOutlook: 'De Outlook',
  couldNotFindPlace: where => `Solara no encontró “${where}”, así que se usa tu lugar.`,
  noPlaceUsesYours: 'El evento no tiene lugar, así que se usa el tuyo.',
  noPlaceFound: 'No se encontró ningún lugar con ese nombre.',
  placeSearchUnavailable: 'La búsqueda de lugares no está disponible.',
  removeNamed: title => `Quitar ${title}`,
  placeFor: title => `Lugar de ${title}`,
  eventPageFor: title => `Página del evento ${title}`,
  later: 'Más adelante',
  unknown: 'Desconocido',
  fileTooLarge: 'Ese archivo pesa más de 1 MB. Exporta un rango de eventos más corto.',
  notCalendarFile:
    'Ese archivo no es un archivo de calendario (.ics). Usa “Agregar al calendario” o “Exportar” en la página del evento para obtener uno.',
  fileTooSlow: 'Leer ese archivo tardó demasiado. Exporta un rango más corto.',
  couldNotRead: 'No se pudo leer ese archivo.',
  findingPlaces: 'Buscando los lugares…',
  findingPlacesOf: (done, total) => `Buscando los lugares… ${done} de ${total}`,
  saving: 'Guardando…',
  couldNotSaveEvents: 'No se pudieron guardar los eventos. Vuelve a intentarlo.',
  skippedAllDay: n => `${eventos(n)} de todo el día`,
  skippedPast: n => `${eventos(n)} ${plural(n, { one: 'pasado', other: 'pasados' })}`,
  skippedCancelled: n => `${eventos(n)} ${plural(n, { one: 'cancelado', other: 'cancelados' })}`,
  skippedTooFar: n => `${eventos(n)} a más de un año`,
  skippedTooLong: n => `${eventos(n)} de más de una semana`,
  skippedInvalid: n => `${eventos(n)} ${plural(n, { one: 'ilegible', other: 'ilegibles' })}`,
  skippedOverLimit: (n, limit) => `${n} más allá del límite de ${limit} eventos`,
  skippedTooComplex: n =>
    `${n} ${plural(n, { one: 'evento repetido demasiado complejo', other: 'eventos repetidos demasiado complejos' })} para leer`,
  imported: n => punto(`Se ${plural(n, { one: 'importó', other: 'importaron' })} ${eventos(n)}`),
  noneImported: 'No se importó ningún evento.',
  noneFound: 'No se encontraron eventos próximos con hora de inicio en ese archivo.',
  removedStale: n =>
    `Se ${plural(n, { one: 'quitó', other: 'quitaron' })} ${eventos(n)} cancelados o que ya no están en el calendario.`,
  refused: (n, cap) => `${eventos(n)} no ${plural(n, { one: 'cupo', other: 'cupieron' })}. ${cap}`,
  skipped: notes => `Se omitieron: ${notes}.`,
  guessed: n =>
    `${eventos(n)} no ${plural(n, { one: 'tenía', other: 'tenían' })} un lugar que Solara pudiera encontrar; indícalo en el evento.`,
  forecastFrom: date => `Pronóstico desde el ${date}`,
  noForecastHours: 'No hay pronóstico UV para estas horas.',
  nearZero: 'El UV se mantiene cerca de 0 durante el evento.',
  peakAt: (uv, time, average) => `UV máximo ${uv} a ${las(time)} · promedio ${average}`,
  whoGroup: (person, skin) => `${person} (${skin}, la más sensible)`,
  burn: (who, minutes) =>
    `Sin protección, ${who} podría quemarse en unos ${minutes}\u00a0min en el momento de UV máximo.`,
  burnOutlasts: (who, minutes, duration) =>
    `Sin protección, ${who} podría quemarse en unos ${minutes}\u00a0min en el momento de UV máximo; el evento dura ${duration}.`,
  sunscreenReapplyAt: (apply, reapply) =>
    `Protector solar: aplícalo ${apply}, vuelve a aplicarlo a las ${reapply}, y después de nadar o sudar mucho.`,
  sunscreenApply: apply =>
    `Protector solar: aplícalo ${apply}; vuelve a aplicarlo después de nadar o sudar mucho.`,
  headsUpSourceFile: 'un archivo de calendario',
  headsUpSourceLinked: 'un calendario vinculado',
  headsUpRule: (hours, uv, sources, gap) =>
    `unas ${hours} horas antes de un evento al aire libre (uno con una actividad elegida) con UV ${uv} o más, desde ${sources}, como máximo uno cada ${gap} horas (también cuenta los demás que vienen)`,
  sharedWithSolara: 'Compartido con Solara',
  done: 'Listo',
  signInWithGoogle: 'Iniciar sesión con Google',
  addThisCalendar: 'Agregar este calendario',
  notNow: 'Ahora no',
  close: 'Cerrar',
  readingShared: 'Leyendo lo que compartiste…',
  nothingToImport:
    'No hay nada que importar: lo que se compartió ya se importó, o esperó más de 30 minutos. Vuelve a compartirlo para importarlo.',
  readingName: name => `Leyendo ${name}…`,
  eventsIn: name => `Eventos en ${name}`,
  andMore: n => `Y ${eventos(n)} más.`,
  signInToKeep:
    'Inicia sesión para conservarlos: Solara guarda los eventos en tu cuenta. El archivo espera aquí 30 minutos.',
  signInToKeepUnavailable:
    'Inicia sesión para conservarlos: Solara guarda los eventos en tu cuenta. El archivo espera aquí 30 minutos (en este sitio no se puede iniciar sesión).',
  tryAgain: 'Reintentar',
  importCount: n => `Importar ${eventos(n)}`,
  linkIsPage: host =>
    `Ese es un enlace a una página web (${host}), no a un calendario. En la página del evento, usa “Agregar al calendario” o “Exportar” para descargar un archivo .ics y luego comparte el archivo con Solara.`,
  cannotLinkYet: host =>
    `Solara todavía no puede vincular calendarios. Descarga el calendario de ${host} como archivo .ics y comparte el archivo.`,
  linkIsBelow: host =>
    `El enlace de calendario de ${host} está en Calendarios vinculados, más abajo, con los pasos de su proveedor. Revísalo y luego toca Vincular calendario.`,
  linkIt: host =>
    `Un enlace de calendario de ${host}. Vincúlalo y Solara mantendrá sus eventos al día.`,
  linkSignIn: host =>
    `Un enlace de calendario de ${host}. Los calendarios vinculados mantienen al día los eventos de un calendario y son parte de Pro, así que primero inicia sesión. El enlace espera aquí 30 minutos.`,
  linkPro: host =>
    `Un enlace de calendario de ${host}. Los calendarios vinculados, que mantienen al día los eventos de un calendario, son parte de Pro.`,
  noneFoundIn: name => `No se encontraron eventos próximos con hora de inicio en ${name}.`,
  hasUpcoming: (name, n) =>
    `${name} tiene ${eventos(n)} ${plural(n, { one: 'próximo', other: 'próximos' })}.`,
  shareTooLarge:
    'Ese archivo pesa más de 1 MB. Exporta un rango de eventos más corto y vuelve a compartirlo.',
  shareNotCalendar:
    'Solara solo puede importar archivos de calendario (.ics). En la página del evento, usa “Agregar al calendario” o “Exportar” para obtener uno y luego comparte ese archivo.',
  shareNothing:
    'No llegó nada con lo que compartiste. Comparte un archivo de calendario (.ics) o un enlace de calendario.',
} satisfies Translation<typeof events>

export const needsReview: (keyof typeof events)[] = [
  'whoGroup',
  'burn',
  'burnOutlasts',
  'sunscreenReapplyAt',
  'sunscreenApply',
  'headsUpRule',
]
