import type { Translation } from '@solara/core/i18n'
import type share from '../share'

export default {
  openSolara: 'Abrir Solara',
  cannotShow: 'No se puede mostrar este enlace compartido',
  cannotShowBody:
    'El enlace está incompleto, vencido o tiene texto que Solara no muestra. Pide un enlace nuevo a quien te lo envió, o planifica tu propio horario de UV más bajo en Solara.',
  planYourOwn: 'Planifica tu propio horario de UV más bajo',
  sharedPlan: 'Plan compartido de Solara',
  pastDay: 'Este plan era para un día que ya pasó. Abre Solara para ver el pronóstico de hoy.',
  recommendedWindow: 'Horario recomendado',
  peakUv: 'UV máximo',
  disclaimer:
    'Es una estimación basada en el pronóstico, no consejo médico. Vuelve a revisar el UV actual y usa la protección solar adecuada. Los nombres de la actividad y del lugar los escribió la persona que compartió este enlace.',
} satisfies Translation<typeof share>
