import { plural, type Translation } from '@solara/core/i18n'
import { las, punto } from '@solara/core/messages/es/grammar'
import type dashboard from '../dashboard'

export default {
  addingToCalendar: 'Agregando a tu Google Calendar…',
  scheduledOnCalendar: (activity, time) =>
    `✓ Se programó ${activity} a ${las(time)}. Ya está en tu Google Calendar.`,
  addToCalendarFailed:
    'No se pudo agregar a Google Calendar. No se guardó nada; vuelve a intentarlo.',
  noUvDataTitle: 'No hay datos de UV para este periodo',
  noUvDataBody: (from, to) => punto(`Hay datos de UV entre ${las(from)} y ${las(to)}`),
  disclaimer:
    'Estimaciones basadas en el pronóstico, no son consejo médico. Las condiciones pueden cambiar; protégete del sol.',

  uvByHour: 'UV por hora',
  uvByHourHelp:
    'Cada barra muestra el índice UV de esa hora. Pasa el cursor o toca para ver el tiempo hasta quemarte y las condiciones.',
  sunIsDown: 'El sol ya se puso',
  beforeSunrise: 'Antes del amanecer',
  uvReturnsAbout: when => `El UV vuelve hacia ${las(when)}`,
  uvValue: uv => `UV ${uv}`,
  burnAbout: duration => `quemadura en ~${duration}`,
  rainChance: percent => `${percent}% de lluvia`,
  headAt: time => ` a ${las(time)}`,
  headNow: ' ahora',
  headPeak: ' máximo',

  spokenHours: h => `${h} ${plural(h, { one: 'hora', other: 'horas' })}`,
  spokenMinutes: m => `${m} ${plural(m, { one: 'minuto', other: 'minutos' })}`,
  burnWhoseGroup: (person, skin) => `la ${skin} de ${person}, la más sensible de tu grupo,`,
  burnWhoGroup: person => `${person} (la más sensible)`,
  burnTitle: 'Tiempo estimado hasta quemarte',
  burnHelp: whose =>
    `Una estimación aproximada para ${whose} sin protector solar con este nivel de UV. No la uses como cronómetro para estar al sol sin protección.`,
  noBurnRisk: 'Sin riesgo de quemadura',
  burnNow: who => `Ahora · ${who}, sin FPS`,
  burnAtPeak: who => `En el máximo · ${who}, sin FPS`,
  editSkinType: 'Editar tipo de piel',
  edit: 'Editar',
  until: when => `Hasta ${las(when)}`,
  vitdTitle: 'Estimación de vitamina D',
  vitdHelp: dose =>
    `Unas ${dose} UI de vitamina D para una persona adulta con brazos y piernas descubiertos: más o menos un tercio del tiempo que tarda la piel en enrojecer (la regla práctica habitual, Holick, 2004). Un modelo aproximado, no una meta de exposición recomendada. Las necesidades y la producción varían mucho y bajan con la edad; consulta a un profesional de la salud si te preocupa.`,
  vitdDose: dose => `≈${dose} UI · brazos\u00a0+\u00a0piernas`,
  uvTooLow: 'UV demasiado bajo',
  needsUv1: 'Necesita UV de 1 o más',
  vitdLog: 'Registro de vitamina D',
  vitdLogHint: 'Anota tu tiempo al sol',

  shareFailed: 'No se pudo compartir. Revisa tu conexión y vuelve a intentarlo.',
  sharedBriefing: 'Se compartió el resumen.',
  copiedBriefing: 'Se copiaron el resumen y el enlace.',
  shareUnsupported: 'Aquí no se puede compartir.',
  share: 'Compartir',
  briefingLocked:
    'El UV máximo, el mejor horario y el tiempo hasta quemarte de mañana vienen con una cuenta gratis.',
  signInToPlanTomorrow: 'Inicia sesión gratis para planificar mañana',
  atAGlance: day => `${day} de un vistazo`,
  atAGlanceShareTitle: day => `${day} de un vistazo - Solara`,
  dayIn: (day, city) => `${day} en ${city}`,

  next10Days: 'Próximos 10 días',
  refresh: 'Actualizar',
  refreshForecast: 'Actualizar el pronóstico',
  moreDays: 'Más días',
  goPro10Days: 'Pásate a Pro para planificar 10 días',
  seeNext10Days: 'Mira los próximos 10 días con Pro',

  chipUv: 'UV ',
  chipLevel: level => `, ${level}, `,
  chipNow: 'Ahora',
  chipAt: time => (/^1(?!\d)/.test(time) ? 'a la ' : 'a las '),
  chipCurrentHour: ', hora actual',
  chipNoData: time => `Sin datos de UV ${/^1(?!\d)/.test(time) ? 'a la' : 'a las'} `,
  uvScale: 'Escala UV',
  uvForecastByHour: 'Pronóstico UV por hora',
  todaysPeak: 'Máximo de hoy',
  peak: 'Máximo',
  noData: 'Sin datos',
  moreInfo: 'Más información',

  activities: 'Actividades',
  activitiesIntro: 'Agrega lo que haces al aire libre y Solara calculará horarios de UV más bajo.',
  addActivity: '+ Agregar actividad',
  manage: 'Administrar',
  savePlanTitle: 'Guarda tu plan, inicia sesión gratis',
  signInFree: 'Iniciar sesión gratis',
  savePlanBody: activities =>
    `Tu plan solo se guarda en este dispositivo. Inicia sesión con Google para tenerlo en todos tus dispositivos, planificar hasta ${activities} actividades y ver también mañana.`,
  noActivitiesTitle: 'Todavía no tienes actividades',
  noActivitiesBody:
    'Agrega tus actividades al aire libre para ver horarios de UV más bajo según el pronóstico.',

  windowsPassedSignIn: 'Inicia sesión gratis para planificar mañana.',
  windowsPassedNone:
    'Ningún día posterior del pronóstico tiene un horario de UV más bajo para esta actividad.',
  windowsPassedNext: (when, time) => punto(`Próximo horario: ${when} a ${las(time)}`),

  forecastErrorLoad:
    'El servicio de pronóstico no responde en este momento. Solara volverá a intentarlo en un minuto.',
  forecastErrorRefresh:
    'El servicio de pronóstico no responde, así que este es el último pronóstico que recibió Solara. Volverá a intentarlo en un minuto.',
  accountLoadError:
    'No se pudo cargar tu cuenta guardada. No se cambió nada. Revisa tu conexión y vuelve a intentarlo.',
  accountCreateError:
    'No se pudo terminar de configurar tu cuenta. No se guardó nada. Revisa tu conexión y vuelve a intentarlo.',
  accountLoadFailed: 'No se pudo cargar la cuenta',
  syncNewerVersion:
    'Solara se actualizó en otra pestaña o dispositivo. Recarga para seguir editando tu configuración.',
  syncFailed:
    'Se guardó en este dispositivo, pero falló la sincronización con la nube. Reintenta cuando vuelvas a tener conexión.',

  checkoutCanceled: 'Se canceló el pago. No se te cobró nada.',
  checkoutNoSession: 'El pago se completó. Actualiza la página para confirmar tu suscripción.',
  checkoutConfirming: 'Confirmando tu suscripción...',
  checkoutPending: 'Tu pago todavía se está procesando. Pro se activará solo cuando termine.',
  checkoutFailed: 'Tu pago no se completó. Puedes volver a intentarlo desde los planes Pro.',
  checkoutSucceeded: 'Pro está activo en tu cuenta.',
  checkoutUnreachable:
    'No se pudo confirmar tu suscripción. Revisa tu conexión y actualiza la página.',

  eventLinkDetails:
    'Estimación de horario de UV más bajo de Solara, basada en el pronóstico. Vuelve a revisar el UV actual y protégete del sol.',

  sunscreenTimer: 'Temporizador de protector solar',
  headingOut: duration =>
    `¿Vas a salir? Recibe un recordatorio para volver a aplicarlo cada ${duration}.`,
  startTimer: 'Iniciar',
  howMuchSunscreen: '¿Cuánto protector solar?',
} satisfies Translation<typeof dashboard>

export const needsReview: (keyof typeof dashboard)[] = [
  'disclaimer',
  'burnWhoseGroup',
  'burnWhoGroup',
  'burnTitle',
  'burnHelp',
  'noBurnRisk',
  'burnNow',
  'burnAtPeak',
  'burnAbout',
  'vitdTitle',
  'vitdHelp',
  'vitdDose',
  'uvTooLow',
  'needsUv1',
  'eventLinkDetails',
  'headingOut',
]
