import { formatNumber, plural, type Translation } from '@solara/core/i18n'
import type linked from '../linked'

export default {
  linkedCalendars: 'Calendarios vinculados',
  pro: 'Pro',
  seePro: 'Ver Pro',
  addFrom: 'Agregar un calendario desde…',
  calendarLink: 'Enlace del calendario',
  removeConfirm: '¿Quitarlo junto con sus eventos?',
  remove: 'Quitar',
  keep: 'Conservar',
  refresh: 'Actualizar',
  linkPrivate:
    'El enlace se queda privado en el servidor de Solara; aquí solo se muestra su sitio. Quitar un calendario quita sus eventos.',
  somethingWrong: 'Algo salió mal.',
  linkedUnread: title => `Se vinculó ${title}, pero todavía no se pudieron leer sus eventos.`,
  linked: (title, n) =>
    `Se vinculó ${title}: ${n} ${plural(n, { one: 'evento próximo', other: 'eventos próximos' })}.`,
  countOf: (count, cap) => `${count} de ${cap}`,
  stoppedRefreshing:
    'Los calendarios vinculados son parte de Pro, así que los tuyos dejaron de actualizarse. Sus eventos se quedan hasta que terminen, o quítalos más abajo.',
  withProPaste: hours =>
    `Con Pro, pega el enlace de un calendario, como el de un club o una carrera, y Solara mantendrá sus eventos al día, revisándolo cada ${hours} horas.`,
  paste: hours =>
    `Pega el enlace de un calendario, como el de un club o una carrera, y Solara mantendrá sus eventos al día, revisándolo cada ${hours} horas.`,
  pasteHint: hours =>
    `Pega el enlace de un calendario (https:// o webcal://), como el de un club o una carrera, y Solara mantendrá sus eventos al día, revisándolo cada ${hours} horas.`,
  checkingLink: 'Revisando el enlace…',
  linkCalendar: 'Vincular calendario',
  capReached: cap =>
    `Vinculaste ${cap} calendarios, el máximo que puede guardar una cuenta. Quita uno para vincular otro.`,
  loadFailed: 'No se pudieron cargar tus calendarios vinculados. Revisa tu conexión.',
  removedNamed: title => `Se quitó ${title} junto con sus eventos.`,
  refreshNamed: title => `Actualizar ${title}`,
  couldNotRead: title => `No se pudo leer ${title}.`,
  refreshed: title => `Se actualizó ${title}.`,
  removeNamed: title => `Quitar ${title}`,
  signInAgain: 'Vuelve a iniciar sesión para administrar los calendarios vinculados.',
  fallback: 'No se pudo conectar con Solara. Revisa tu conexión y vuelve a intentarlo.',
  upcomingEvents: n =>
    `${formatNumber(n)} ${plural(n, { one: 'evento próximo', other: 'eventos próximos' })}`,
  pausedPro:
    'En pausa: los calendarios vinculados son parte de Pro. Con Pro, actualiza para reanudarlo.',
  pausedFailures: reason =>
    `En pausa después de una semana de revisiones fallidas. ${reason} Actualiza para volver a intentarlo.`,
  lastCheckFailed: reason =>
    `Falló la última revisión. ${reason} Solara volverá a intentarlo automáticamente.`,
  refused: (n, max) =>
    `${formatNumber(n)} ${plural(n, { one: 'evento no cupo', other: 'eventos no cupieron' })}: una cuenta guarda como máximo ${max} eventos. Quita algunos para hacer espacio.`,
  pasteBelow: 'Pega el enlace abajo.',
  onComputer: 'En una computadora',
  onPhone: 'En iPhone o iPad',
  icloudLabel: 'Apple iCloud',
  icloudStep1: 'Entra a icloud.com/calendar e inicia sesión.',
  icloudStep2: 'Haz clic en el botón de información junto al calendario.',
  icloudStep3: 'Activa Calendario público y haz clic en Copiar.',
  icloudPhoneStep1: 'Abre Calendario y toca Calendarios.',
  icloudPhoneStep2: 'Toca el botón de información junto al calendario.',
  icloudPhoneStep3: 'Activa Calendario público y toca Compartir enlace y Copiar.',
  icloudNote1: 'Solo quien es dueño del calendario puede hacerlo público.',
  icloudNote2: 'Para dejar de compartirlo, desactiva Calendario público.',
  googleLabel: 'Google',
  googleStep1: 'En una computadora, abre Google Calendar.',
  googleStep2: 'Haz clic en Configuración y luego en Configuración.',
  googleStep3: 'En Configuración de mis calendarios, haz clic en el calendario.',
  googleStep4: 'Haz clic en Integrar el calendario.',
  googleStep5: 'Copia la Dirección secreta en formato iCal.',
  googleNote1: 'Google muestra esta dirección solo en una computadora.',
  googleNote2: 'Con una cuenta de trabajo o escuela, tu administrador podría haberla desactivado.',
  googleNote3: 'Si el enlace se filtra, haz clic en Restablecer en el mismo lugar.',
  outlookLabel: 'Outlook.com',
  outlookStep1: 'En una computadora, abre Outlook.com y ve a Calendario.',
  outlookStep2: 'Abre Configuración, luego Calendario y luego Calendarios compartidos.',
  outlookStep3: 'En Publicar un calendario, elige el calendario y Puede ver títulos y ubicaciones.',
  outlookStep4: 'Haz clic en Publicar y luego copia el vínculo ICS.',
  outlookNote1: 'Outlook publica calendarios solo desde una computadora.',
  outlookNote2: 'Para cambiar el enlace, usa Restablecer vínculos o Cancelar publicación ahí.',
  yahooLabel: 'Yahoo',
  yahooSummary:
    'En una computadora, abre la configuración para compartir del calendario en Yahoo Calendar, copia su enlace ICS y pégalo abajo.',
  yahooNote1:
    'La ayuda de Yahoo no describe estos enlaces, así que sus menús pueden ser distintos.',
  yahooNote2: 'Para dejar de compartirlo, desactiva el enlace para compartir.',
  googleEventsNote: 'O muestra los eventos de Google Calendar más arriba, sin enlace.',
  sharedKey:
    'Este enlace funciona como una contraseña: cualquiera que lo tenga puede leer todos los eventos de ese calendario, así que mantenlo en privado.',
  sharedSeparate:
    'Un calendario aparte para tus planes al aire libre comparte menos y no pasa del límite de 1 MB de Solara.',
  sharedRefresh: hours =>
    `Solara revisa el enlace más o menos cada ${hours} horas, así que los cambios pueden tardar unas horas en aparecer.`,
} satisfies Translation<typeof linked>
