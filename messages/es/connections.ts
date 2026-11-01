import { formatNumber, plural, type Translation } from '@solara/core/i18n'
import type connections from '../connections'

const eventos = (count: string, n: number) =>
  `${count} ${plural(n, { one: 'evento', other: 'eventos' })}`

export default {
  googleCalendar: 'Google Calendar',
  outlook: 'Outlook',
  disconnect: 'Desconectar',
  removeAccessConfirm: '¿Quitar sus eventos y el acceso de Solara?',
  removeEventsConfirm: '¿Quitar sus eventos de Solara?',
  keep: 'Conservar',
  refresh: 'Actualizar',
  chooseCalendars: 'Elegir calendarios',
  calendarsToShow: 'Calendarios de los que mostrar eventos',
  save: 'Guardar',
  cancel: 'Cancelar',
  upcomingCount: n =>
    ` · ${formatNumber(n)} ${plural(n, { one: 'evento próximo', other: 'eventos próximos' })}`,
  yourMainCalendar: 'Tu calendario principal',
  yourMainCalendarLower: 'tu calendario principal',
  calendarsCount: n => `${n} calendarios`,
  calendarFallback: 'Calendario',
  connecting: 'Conectando…',
  googlePermissionAgain:
    'Google Calendar necesita tu permiso otra vez. Toca Actualizar para continuar.',
  googleUnreachable: 'No se pudo conectar con Google Calendar. Vuelve a intentarlo.',
  googleDisconnected: 'Se desconectó Google Calendar y se quitaron sus eventos.',
  googleRemovedEvents:
    'Se quitaron los eventos de Google Calendar. Para quitarle también el acceso a Solara, quita Solara en myaccount.google.com/connections.',
  googleHint: days =>
    `Mira el UV en los eventos que ya tienes en tu Google Calendar. Solara lee los próximos ${days} días en este navegador, con acceso de solo lectura, y conserva solo los eventos con una dirección o que coinciden con una de tus actividades. Para encontrar el lugar, solo se busca la ciudad de la dirección.`,
  showGoogle: 'Mostrar mis eventos de Google Calendar',
  googleEndsAll:
    'Google quita a Solara todo el acceso al calendario a la vez, así que las actividades programadas te pedirán conectarte de nuevo.',
  upToCalendars: max => `Muestra eventos de hasta ${max} calendarios.`,
  googleLoadFailed: 'No se pudo cargar tu configuración de Google Calendar. Revisa tu conexión.',
  readingGoogle: 'Leyendo tu Google Calendar…',
  outlookBusy: 'Outlook está ocupado. Vuelve a intentarlo en unos minutos.',
  outlookUnreachable: 'No se pudo conectar con Outlook. Vuelve a intentarlo.',
  microsoftPopupBlocked:
    'Tu navegador bloqueó la ventana de inicio de sesión de Microsoft. Permite las ventanas emergentes para Solara y vuelve a intentarlo.',
  microsoftInsecure:
    'El inicio de sesión de Microsoft necesita una conexión segura. Abre Solara en su dirección https:// y vuelve a intentarlo.',
  adminApproval:
    'Tu organización tiene que aprobar Solara antes de que pueda leer tu calendario de trabajo. Pídeselo a tu equipo de TI.',
  adminApprovalLinked:
    'Tu organización tiene que aprobar Solara antes de que pueda leer tu calendario de trabajo. Pídeselo a tu equipo de TI, o vincula el calendario en Calendarios vinculados.',
  outlookPermissionAgain: 'Outlook necesita tu permiso otra vez. Toca Actualizar para continuar.',
  outlookNotConnected: 'No se conectó Outlook. Vuelve a intentarlo.',
  outlookDisconnected: 'Se desconectó Outlook y se quitaron sus eventos.',
  outlookHint: days =>
    `Mira el UV en los eventos que ya tienes en tu calendario de Outlook.com o Microsoft 365. Solara lee los próximos ${days} días en este navegador, con permiso para leer solo los datos básicos de los eventos, y conserva solo los eventos con una dirección o un lugar elegido en Outlook, o que coinciden con una de tus actividades. Para encontrar el lugar, solo se busca la ciudad de la dirección.`,
  showOutlook: 'Mostrar mis eventos de Outlook',
  upToYourCalendars: max => `Muestra eventos de hasta ${max} de tus calendarios.`,
  outlookLoadFailed: 'No se pudo cargar tu configuración de Outlook. Revisa tu conexión.',
  noTokenStored:
    'Solara no guardó ningún token de Microsoft. Para quitar también el permiso que le diste, usa',
  yourMicrosoftAccount: 'tu cuenta Microsoft',
  outlookComOr: '(Outlook.com) o',
  myApps: 'Mis aplicaciones',
  workOrSchool: '(trabajo o escuela).',
  readingOutlook: 'Leyendo tu calendario de Outlook…',
  syncShowing: (shown, n, service) =>
    `Se ${plural(n, { one: 'muestra', other: 'muestran' })} ${shown} ${plural(n, { one: 'evento próximo', other: 'eventos próximos' })} de ${service}.`,
  syncAllDuplicates: (count, n, service) =>
    plural(n, {
      one: `Tu ${eventos(count, n)} de ${service} ya está en Solara, así que se muestra una vez.`,
      other: `Tus ${eventos(count, n)} de ${service} ya están en Solara, así que se muestran una vez.`,
    }),
  syncNone: days =>
    `Ningún evento de los próximos ${days} días tiene una dirección o coincide con una de tus actividades.`,
  syncDuplicates: (count, n) =>
    plural(n, {
      one: `${eventos(count, n)} que ya está en Solara se muestra una vez.`,
      other: `${eventos(count, n)} que ya están en Solara se muestran una vez.`,
    }),
  syncOverLimit: (count, n) =>
    `${eventos(count, n)} ${plural(n, { one: 'posterior aparecerá', other: 'posteriores aparecerán' })} cuando pasen los más cercanos.`,
  syncRefused: (count, n, cap) =>
    `${eventos(count, n)} no ${plural(n, { one: 'cupo', other: 'cupieron' })}. ${cap}`,
  syncMissing: (calendars, n) =>
    `${calendars} ya no ${plural(n, { one: 'está compartido', other: 'están compartidos' })} contigo.`,
  notUpdated: 'Todavía sin actualizar',
  updatedJustNow: 'Actualizado hace un momento',
  updatedMinutesAgo: n => `Actualizado hace ${n} ${plural(n, { one: 'minuto', other: 'minutos' })}`,
  updatedHoursAgo: n => `Actualizado hace ${n} ${plural(n, { one: 'hora', other: 'horas' })}`,
  updatedOn: date => `Actualizado el ${date}`,
} satisfies Translation<typeof connections>
