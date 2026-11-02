import type { Translation } from '@solara/core/i18n'
import type site from '../site'

export default {
  signIn: 'Iniciar sesión',
  openSolara: 'Abrir Solara',
  backToSolara: '← Volver a Solara',
  lastUpdated: date => `Última actualización: ${date}`,
  otherLanguage: 'English',
  otherLanguageLabel: 'Read this page in English',
  ogImageAlt: 'Solara, planificador de actividades con menos UV',
  disclaimer:
    'Solara sirve para planificar y llevar un registro, no es consejo médico y no puede garantizar que el tiempo al sol sea seguro. Si tienes un problema de salud, tomas un medicamento que te hace más sensible al sol, estás embarazada o te preocupa tu piel o tu vitamina D, consulta a un profesional de la salud.',
} satisfies Translation<typeof site>

/** Safety wording a native speaker must check before release (docs/i18n/es-review.md). */
export const needsReview: (keyof typeof site)[] = ['disclaimer']
