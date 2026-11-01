import type { Translation } from '@solara/core/i18n'
import type account from '../account'

export default {
  loadingAccount: 'Cargando tu cuenta...',
  backToSolara: 'Volver a Solara',
  goToSignIn: 'Ir a iniciar sesión',
  planBilling: 'Plan y facturación',
  downloadData: 'Descarga tus datos',
  whatsIncluded: 'Qué incluye',
  deleteAccount: 'Eliminar la cuenta',
  whatsDeleted: 'Qué se elimina y qué se queda',
  deletedFromSolara: 'Se elimina de Solara',
  outsideSolara: 'Fuera de Solara',
  typeDelete: 'Escribe DELETE para confirmar',
  googleAsksAgain: 'Después, Google te pide iniciar sesión otra vez para confirmar que eres tú.',
  backArrow: '← Volver a Solara',
  accountControls: 'Controles de la cuenta',
  accountLead: 'Administra tu plan, descarga tus datos o elimina tu cuenta.',
  reviewThe: 'Revisa la',
  privacyPolicy: 'Política de privacidad',
  termsOfUse: 'los Términos de uso',
  and: 'y',
  emailFallback: (email, days) =>
    `Si sigue fallando, escribe a ${email} y eliminaremos tu cuenta y todos sus datos en un plazo de ${days} días.`,
  signInToDownload: 'Vuelve a iniciar sesión para descargar tus datos.',
  exportFailed: 'No se pudo completar la exportación.',
  downloadFailed: email =>
    `No se pudieron descargar tus datos. Revisa tu conexión y vuelve a intentarlo, o escribe a ${email} para pedir una copia.`,
  billingFailed: 'Falló la gestión de la facturación.',
  deletionCanceled:
    'Se canceló la eliminación porque Google no confirmó tu cuenta. No se eliminó nada.',
  differentAccount:
    'Esa era otra cuenta de Google. Confirma con la cuenta con la que iniciaste sesión. No se eliminó nada.',
  notConfirmed:
    'Google no pudo confirmar tu cuenta, así que no se eliminó nada. Vuelve a intentarlo.',
  reauthNotConfigured: 'La nueva autenticación con Google no está configurada.',
  deletionIncomplete: 'No se pudo completar la eliminación.',
  deletionFailed: 'Falló la eliminación.',
  deletingData: 'Eliminando tus datos. Mantén esta página abierta.',
  blocked:
    'No se eliminó nada: parte de esta cuenta solo la pueden quitar los servidores de Solara.',
  signInLeft: fallback =>
    `Se eliminaron tus datos, pero no se pudo quitar tu inicio de sesión. Vuelve a intentarlo. ${fallback}`,
  dataLeft: fallback =>
    `No se pudieron eliminar todos tus datos, así que tu cuenta sigue aquí. Revisa tu conexión y vuelve a intentarlo; la eliminación sigue donde se quedó. ${fallback}`,
  deletedTitle: 'Se eliminó tu cuenta',
  pendingTitle: 'La eliminación de tu cuenta está en curso',
  signInRequired: 'Tienes que iniciar sesión',
  deletedBody:
    'Se quitaron tu cuenta de Solara y sus datos, y no queda nada de ella en este navegador.',
  pendingBody:
    'Se cerró tu sesión mientras Solara termina de cancelar la facturación y de quitar los datos de tu cuenta.',
  signInRequiredBody: 'Vuelve a Solara e inicia sesión antes de usar estos controles.',
  billingNote:
    'Cambia de plan, actualiza tu forma de pago, mira tus facturas o cancela de forma segura con Stripe.',
  loadingPlan: 'Cargando tu plan...',
  planLoadFailed: 'No se pudo cargar tu plan. Revisa tu conexión y recarga.',
  opening: 'Abriendo...',
  manageSubscription: 'Administrar la suscripción',
  preparing: 'Preparando...',
  downloadAccountData: 'Descargar los datos de la cuenta',
  serversOnlyStart:
    'Parte de esta cuenta solo la pueden quitar los servidores de Solara, que todavía no están funcionando. Para eliminarla, escribe a',
  serversOnlyEnd: days => `y eliminaremos tu cuenta y todos sus datos en un plazo de ${days} días.`,
  deleting: 'Eliminando...',
  deletePermanently: 'Eliminar para siempre',
  notWorkingStart: '¿Algo no funciona? Escribe a',
  notWorkingEnd: days =>
    `y te enviaremos tus datos o eliminaremos tu cuenta en un plazo de ${days} días.`,
  sectionAccount: 'tus preferencias (lugares, tipo de piel, perfiles y actividades)',
  sectionBilling: 'un resumen de tu plan y de las fechas de facturación',
  sectionScheduled: 'tus actividades programadas',
  sectionImported: 'tus eventos importados',
  sectionLinked: 'tus calendarios vinculados (su sitio y nombre, no sus enlaces)',
  sectionGoogle: 'los calendarios de Google de los que muestras eventos',
  sectionOutlook: 'los calendarios de Outlook de los que muestras eventos',
  sectionAlerts: 'las alertas enviadas la última semana',
  sectionHeadsUps: 'los avisos de eventos de Pro enviados la última semana',
  sectionReminder: 'tu recordatorio de protector solar pendiente de enviar, si lo hay',
  sectionDevices: 'los metadatos de registro de los dispositivos',
  sectionBookkeeping:
    'cuándo se programó por última vez tu recordatorio de protector solar y cuántos se programaron y enviaron ese día, y cuándo se registró un dispositivo por última vez',
  deletedItems:
    'tus preferencias, perfiles y actividades de Solara|las actividades programadas|los eventos importados|los calendarios vinculados|tus opciones de Google Calendar|tus opciones de calendario de Outlook|tu feed de calendario|los dispositivos para notificaciones|el historial de alertas|los recordatorios de protector solar|tu inicio de sesión en Solara',
  exportSummary: 'Obtén una copia de tus datos de Solara en un archivo JSON.',
  exportExcluded:
    'Se dejan fuera por seguridad: los tokens de acceso, como la dirección de tu feed de calendario, y los identificadores del proveedor de pagos.',
  deletionSummary:
    'Elimina para siempre tu cuenta, sus datos y tu inicio de sesión en Solara. No se puede deshacer.',
  noteBilling:
    'Una suscripción se cancela al instante, sin reembolso del periodo actual, y tus datos de facturación se eliminan en Stripe.',
  noteGoogle:
    'Los eventos que ya se agregaron a tu Google Calendar se quedan ahí. Para quitarle el acceso a Solara, quita Solara en myaccount.google.com/connections.',
  noteOutlook:
    'Los eventos de tu calendario de Outlook también se quedan ahí, y Solara nunca guardó un token de Microsoft. Para quitar el permiso que le diste, usa los permisos de aplicaciones de tu cuenta Microsoft.',
  noteTrial:
    'Si tuviste la prueba gratis, se guarda un registro cifrado de ella durante 2 años, para que la prueba sea una sola vez por persona.',
  truncatedDevices: 'dispositivos',
  truncatedScheduled: 'actividades programadas',
  truncatedImported: 'eventos importados',
  downloaded: 'Se descargaron los datos de tu cuenta.',
  downloadedTruncated: (count, sections) =>
    `Se descargaron los datos de tu cuenta. Incluyen los primeros ${count} registros de ${sections}; la política de privacidad explica cómo pedir el resto.`,
  servicesUnavailable: 'Los servicios de la cuenta no están disponibles.',
  someDataLeft: 'No se pudieron eliminar algunos datos de la cuenta.',
  documentsLeft: n => `Quedan ${n} documentos de la cuenta.`,
  signInNotDeleted: 'No se pudo eliminar el inicio de sesión.',
} satisfies Translation<typeof account>
