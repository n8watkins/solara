import type { Translation } from '../../i18n'
import type linking from '../linking'

export default {
  errInvalidUrl:
    'Ese no es un enlace de calendario. Copia la dirección completa https:// o webcal://.',
  errNotHttps: 'Solo se pueden vincular enlaces de calendario https:// y webcal://.',
  errCredentials: 'No se pueden vincular enlaces con usuario o contraseña.',
  errPort: 'Solo se pueden vincular enlaces de calendario en el puerto https estándar.',
  errBlocked: 'Ese enlace apunta a una dirección de red privada o local.',
  errUnreachable: 'No se pudo conectar con el sitio del calendario.',
  errTimeout: 'El sitio del calendario tardó demasiado en responder.',
  errTooLarge: 'Ese calendario pesa más de 1 MB. Vincula un calendario más corto.',
  errRedirects: 'Ese enlace redirige demasiadas veces.',
  errHttpStatus:
    'El sitio del calendario rechazó la solicitud. Revisa que el enlace siga funcionando.',
  errNotCalendar: 'Ese enlace no lleva a un archivo de calendario (.ics).',
  errNoPlace: 'Primero indica tu lugar en Solara, así los eventos sin lugar pueden usarlo.',
  errDuplicate: 'Ese calendario ya está vinculado.',
  errProRequired: 'Los calendarios vinculados son parte de Pro.',
  errTooMany: max =>
    `Una cuenta puede vincular hasta ${max} calendarios. Quita uno para agregar otro.`,
  errUnknown: 'No se pudo leer el calendario.',
  probIcloudWebsite: 'Ese es el sitio web de iCloud. Activa Calendario público y copia su enlace.',
  probGooglePublic:
    'Esa es la dirección pública de Google, que solo funciona con un calendario público. Para el tuyo, copia la Dirección secreta en formato iCal.',
  probGooglePage:
    'Esa es una página de Google Calendar. Copia la Dirección secreta en formato iCal.',
  probOutlookHtml: 'Ese es el vínculo HTML. Copia el vínculo ICS.',
  probOutlookWebsite:
    'Ese es el sitio web de Outlook. Publica el calendario y copia su vínculo ICS.',
  probYahooPage:
    'Esa es una página de Yahoo. Copia el enlace que aparece bajo Para importar a una aplicación de calendario (ICS).',
  probIcloudUnusual:
    'Este no es el enlace habitual de un calendario de iCloud. Si falla al vincular, activa Calendario público y copia su enlace.',
  probGoogleUnusual:
    'Esta no es la dirección secreta habitual de Google Calendar. Si falla al vincular, copia la Dirección secreta en formato iCal.',
  probOutlookUnusual:
    'Este no es el vínculo habitual de un calendario publicado de Outlook. Si falla al vincular, publica el calendario y copia su vínculo ICS.',
  probYahooUnusual:
    'Este no es el enlace habitual de Yahoo Calendar. Si falla al vincular, copia el enlace que aparece bajo Para importar a una aplicación de calendario (ICS).',
  providerIcloud: 'iCloud',
  providerGoogle: 'Google Calendar',
  providerOutlook: 'Outlook',
  providerYahoo: 'Yahoo Calendar',
  feedIcloud: 'un enlace público de un calendario de iCloud',
  feedGoogle: 'una dirección secreta de Google Calendar',
  feedOutlook: 'un calendario publicado de Outlook (vínculo ICS)',
  feedYahoo: 'un enlace ICS de Yahoo Calendar',
  looksLike: what => `Parece ${what}.`,
} satisfies Translation<typeof linking>
