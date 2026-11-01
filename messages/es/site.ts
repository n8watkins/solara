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
    'Solara es una ayuda para planificar, no un consejo médico ni una garantía de que exponerse al sol sea seguro. Las condiciones y la sensibilidad de cada persona pueden cambiar rápidamente.',
} satisfies Translation<typeof site>

/** Safety wording a native speaker must check before release (docs/i18n/es-review.md). */
export const needsReview: (keyof typeof site)[] = ['disclaimer']
