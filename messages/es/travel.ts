import type { Translation } from '@solara/core/i18n'
import type travel from '../travel'

export default {
  seemToBeIn: place => `Parece que estás en ${place}. ¿Mostrar el UV de aquí?`,
  switchHere: 'Cambiar',
  notNow: 'Ahora no',
} satisfies Translation<typeof travel>

/** Which place's UV shows: a native speaker checks it (docs/i18n/es-review.md). */
export const needsReview: (keyof typeof travel)[] = ['seemToBeIn']
