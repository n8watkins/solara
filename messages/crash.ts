// The words of the page shown when the app crashes (app/global-error.tsx), in every
// language at once, like messages/static.ts (components/StaticText.tsx). Next loads that
// page with every page, so its words are a module of their own: the opening screen's
// chunk does not carry them, and the crash page carries no other static text (ROADMAP
// item 52).
import type { StaticMessage } from './static'

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
