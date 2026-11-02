import type { Translation } from '@solara/core/i18n'
import type app from '../app'
import { punto } from '@solara/core/messages/es/grammar'

export default {
  documentTitle: 'Solara: planifica según el UV',
  signOutPaused:
    'Se pausó el cierre de sesión porque no se pudieron desactivar las notificaciones. Revisa tu conexión y vuelve a intentarlo.',
  signOutFailed: 'No se pudo cerrar la sesión. Revisa tu conexión y vuelve a intentarlo.',
  currentUv: (value, level) => `Índice UV actual ${value}, ${level}`,
  pro: 'Pro',
  visitingPlace: (place, home) => `De visita en ${place}, tu casa es ${home}`,
  settings: 'Configuración',
  signIn: 'Iniciar sesión',
  viewDashboard: 'Panel',
  viewDashboardHeading: 'Panel UV',
  viewCalendar: 'Calendario',
  viewCalendarHeading: 'Calendario de actividades',
  forecastStale: stamp =>
    `Se muestra el pronóstico actualizado a ${stamp}. Uno más reciente se cargará solo.`,
  offlineWithForecast: stamp =>
    punto(`Estás sin conexión. Se muestra el pronóstico actualizado a ${stamp}`),
  offlineNoForecast: 'Estás sin conexión. El pronóstico se cargará cuando vuelvas a conectarte.',
  offlineReadOnly: ' Podrás hacer cambios cuando vuelvas a conectarte.',
  accountLoadErrorTitle: 'No se pudo cargar tu cuenta',
  tryAgain: 'Reintentar',
  errorThisSection: 'esta sección',
  errorDashboard: 'el panel',
  errorCalendar: 'el calendario',
  errorTitle: what => `Algo salió mal al cargar ${what}`,
  errorBody:
    'Esto suele resolverse al reintentar. Si sigue pasando, puede que tus datos guardados estén desactualizados.',
  reloadApp: 'Recargar la app',
  continueWithGoogle: 'Continuar con Google',
  signingIn: 'Iniciando sesión...',
  popupBlocked:
    'Tu navegador bloqueó la ventana de inicio de sesión. Vuelve a intentarlo para continuar.',
  signInFailed: 'No se pudo completar el inicio de sesión. Vuelve a intentarlo.',
  signInNoConnection:
    'No se pudo conectar con Google para iniciar sesión. Revisa tu conexión y vuelve a intentarlo.',
  signInUpdated: 'Solara se acaba de actualizar. Recarga la página para iniciar sesión.',
  updatedReloaded: 'Solara se actualizó mientras esta página estaba abierta, así que se recargó.',
  updatedReloadedSignIn:
    'Solara se actualizó mientras esta página estaba abierta, así que se recargó. Elige Iniciar sesión otra vez para continuar.',
  notNow: 'Ahora no',
  loadingForecast: 'Cargando el pronóstico…',
  dismiss: 'Descartar',
  titleAccount: 'Controles de datos de la cuenta | Solara',
  titleShare: 'Horario de actividad compartido | Solara',
  titleNotFound: 'Página no encontrada | Solara',
  morningSummaryReady: 'Ya está listo tu resumen matutino más reciente.',
  retry: 'Reintentar',
  reload: 'Recargar',
  retrySync: 'Reintentar la sincronización',
} satisfies Translation<typeof app>
