import type { Translation } from '@solara/core/i18n'
import type landing from '../landing'

export default {
  title: 'Solara: planifica según el UV',
  description:
    'Planificación de actividades con menos UV, basada en el pronóstico y personalizada según tu tipo de piel y tu ubicación.',
  socialDescription:
    'Planificación de actividades con menos UV, basada en el pronóstico, según tu tipo de piel y tu ubicación.',
  eyebrow: 'Planificación del UV para quienes disfrutan del aire libre',
  heading: 'Sabe cuándo salir',
  intro:
    'Solara lee el pronóstico del UV donde estás y encuentra los horarios con menos UV para correr, hacer senderismo, nadar y todo lo que haces al aire libre, según tu piel.',
  tryItNow: 'Pruébalo ahora',
  freeToUse: 'Es gratis. No necesitas una cuenta para empezar.',
  screenshotAlt:
    'Solara en un teléfono: el próximo horario con menos UV para correr, el índice UV actual y el pronóstico del UV por hora para hoy.',
  screenshotCaption: 'Una captura de pantalla del panel de Solara.',
  howItWorks: 'Cómo funciona',
  step: n => `Paso ${n}`,
  stepPlaceTitle: 'Elige tu lugar y tu piel',
  stepPlaceBody:
    'Escribe una ciudad o usa tu ubicación y elige tu tipo de piel. Verás el índice UV en vivo de inmediato.',
  stepActivitiesTitle: 'Agrega lo que haces al aire libre',
  stepActivitiesBody:
    'Correr, hacer senderismo, nadar, la jardinería o tu propia actividad, cada una con cuánto sol puede tolerar.',
  stepGoTitle: 'Sal cuando haya menos UV',
  stepGoBody:
    'Solara lee el pronóstico por hora y muestra el horario con menos UV de cada actividad y el mejor día, hasta 10 días adelante con Pro.',
  plansHeading: 'Empieza gratis y mejora tu plan cuando quieras más',
  plansIntro:
    'Prueba Solara sin una cuenta. Inicia sesión gratis para tener tu plan en todos tus dispositivos.',
  guest: 'Invitado',
  guestNote:
    'Sin iniciar sesión. Tu plan se guarda en este navegador; inicia sesión para no perderlo.',
  freeAccount: 'Cuenta gratis',
  freeNote: 'Inicia sesión con Google. Sincronizado en todas partes.',
  signInFree: 'Inicia sesión gratis',
  pro: 'Pro',
  perMonth: ' / mes',
  proNote: (yearly, trialDays) =>
    `o ${yearly} al año. ${trialDays} días de prueba gratis. Muy pronto: inicia sesión para unirte a la lista de espera.`,
  joinWaitlist: 'Únete a la lista de espera',
  featureComingSoon: feature => `${feature} (muy pronto)`,
  citiesHeading: 'UV típico por ciudad',
  citiesIntro: 'Qué tan fuerte es el sol cada mes y cuándo el UV llega a 3 o más.',
  allCities: 'Todas las ciudades',
} satisfies Translation<typeof landing>
