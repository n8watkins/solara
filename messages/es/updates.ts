import type { Translation } from '@solara/core/i18n'
import type updates from '../updates'

export default {
  reloaded: 'Solara se actualizó mientras esta página estaba abierta, así que se recargó.',
  reloadedSignIn:
    'Solara se actualizó mientras esta página estaba abierta, así que se recargó. Elige Iniciar sesión otra vez para continuar.',
} satisfies Translation<typeof updates>
