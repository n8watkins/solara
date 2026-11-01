// Text in the static HTML of the app's pages, in every language at once
// (components/StaticText.tsx): the loading screen, the footer and the pages that run no
// script. Each text is its own export, so a page carries only the ones it shows; the
// type makes every text name every language.
import type { Locale } from '@solara/core/i18n'

type StaticMessage = Readonly<Record<Locale, string>>

// The analytics consent banner (components/AnalyticsConsent.tsx), drawn before any script.
export const consentTitle: StaticMessage = {
  en: 'Help improve Solara',
  es: 'Ayuda a mejorar Solara',
}
export const consentLong: StaticMessage = {
  en: 'Allow optional analytics to help us understand which features are useful. Nothing loads unless you choose Allow.',
  es: 'Permite analíticas opcionales para ayudarnos a entender qué funciones son útiles. No se carga nada a menos que elijas Permitir.',
}
export const consentShort: StaticMessage = {
  en: 'Optional analytics, off unless you allow it.',
  es: 'Analíticas opcionales, desactivadas a menos que las permitas.',
}
export const consentPrivacy: StaticMessage = { en: 'Privacy details', es: 'Detalles de privacidad' }
export const consentAllow: StaticMessage = { en: 'Allow analytics', es: 'Permitir analíticas' }
export const consentNotNow: StaticMessage = { en: 'Not now', es: 'Ahora no' }

// The page shown when the app crashes (app/global-error.tsx).
export const crashTitle: StaticMessage = {
  en: 'Something went wrong | Solara',
  es: 'Algo salió mal | Solara',
}
export const crashHeading: StaticMessage = { en: 'Something went wrong', es: 'Algo salió mal' }
export const crashBody: StaticMessage = {
  en: 'Solara hit an unexpected problem. Trying again usually fixes it; your saved settings are safe.',
  es: 'Solara tuvo un problema inesperado. Volver a intentarlo suele resolverlo; tu configuración guardada está a salvo.',
}
export const tryAgain: StaticMessage = { en: 'Try again', es: 'Reintentar' }
export const reloadApp: StaticMessage = { en: 'Reload app', es: 'Recargar la app' }

export const loading: StaticMessage = { en: 'Loading...', es: 'Cargando...' }
export const footerPrivacy: StaticMessage = { en: 'Privacy', es: 'Privacidad' }
export const footerTerms: StaticMessage = { en: 'Terms', es: 'Términos' }
export const footerAccountData: StaticMessage = { en: 'Account data', es: 'Datos de la cuenta' }
export const notFoundTitle: StaticMessage = { en: 'Page not found', es: 'Página no encontrada' }
export const notFoundBody: StaticMessage = {
  en: "This address doesn't match anything in Solara. Check the link, or head back to your forecast.",
  es: 'Esta dirección no coincide con nada en Solara. Revisa el enlace o vuelve a tu pronóstico.',
}
export const openSolara: StaticMessage = { en: 'Open Solara', es: 'Abrir Solara' }
export const outlookTitle: StaticMessage = { en: 'Connecting Outlook', es: 'Conectando Outlook' }
export const outlookBody: StaticMessage = {
  en: 'You can close this window and go back to Solara.',
  es: 'Puedes cerrar esta ventana y volver a Solara.',
}
export const shareAgainTitle: StaticMessage = {
  en: 'Share it again',
  es: 'Vuelve a compartirlo',
}
export const shareAgainBody: StaticMessage = {
  en: 'Solara was still getting ready and did not receive what you shared. Open Solara once, then share the calendar file or link again.',
  es: 'Solara todavía se estaba preparando y no recibió lo que compartiste. Abre Solara una vez y luego vuelve a compartir el archivo o enlace del calendario.',
}
