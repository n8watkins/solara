import type { Translation } from '@solara/core/i18n'
import type pricing from '../pricing'
import { punto } from '@solara/core/messages/es/grammar'

export default {
  signInGoogleFree: 'Inicia sesión con Google. Es gratis y tu plan viene contigo.',
  emailEarlyAccess: 'Correo para acceso anticipado',
  choosePay: 'Elige cómo pagar',
  included: 'Incluido',
  notIncluded: 'No incluido',
  columnGuest: 'Invitado',
  columnFree: 'Gratis',
  columnPro: 'Pro',
  monthly: 'Mensual',
  // In Mexico and much of Latin America "$" means the local peso: say it is US dollars.
  priceUsd: amount => `US$${amount}`,
  yearly: 'Anual',
  perMonth: 'mes',
  perYear: 'año',
  savePercent: percent => `−${percent}%`,
  checkoutUnavailable: 'El pago no está disponible por ahora',
  billingUnavailable: 'La gestión de la facturación no está disponible por ahora',
  guestTrial: 'Inicia sesión gratis para guardar tu plan, ver mañana y empezar una prueba de Pro.',
  guestWaitlist:
    'Inicia sesión gratis para guardar tu plan, ver mañana y unirte a la lista de espera de Pro.',
  signInFree: 'Iniciar sesión gratis',
  afterTrial: days => `Después de la prueba gratis de ${days} días. Cancela cuando quieras.`,
  openingCheckout: 'Abriendo el pago...',
  startTrial: 'Empezar la prueba gratis',
  onWaitlist: '✓ En la lista de espera',
  joinWaitlist: 'Unirme a la lista de espera de Pro',
  solaraPro: 'Solara Pro',
  storeLead: activities =>
    `Una cuenta gratis guarda tu plan en todos tus dispositivos, planifica hasta ${activities} actividades y también muestra mañana.`,
  proLead:
    '10 días de planificación, hasta 20 actividades, perfiles familiares que planifican para la persona más sensible, y alertas matutinas y de UV.',
  proLeadSoon:
    '10 días de planificación, hasta 20 actividades, perfiles familiares que planifican para la persona más sensible, y alertas matutinas y de UV (muy pronto).',
  launchingSoon: days =>
    `Pro llega muy pronto. Únete a la lista de espera para ser de los primeros en tener la prueba gratis de ${days} días.`,
  newSubscribers: days =>
    `Las nuevas suscripciones empiezan con una prueba gratis de ${days} días. Stripe pide una tarjeta y no cobra nada hasta que termine.`,
  bothStartTrial: days =>
    `Ambos empiezan con una prueba gratis de ${days} días. Cancela cuando quieras.`,
  captionStore: 'Funciones de los planes Invitado y Gratis',
  captionGuest: 'Funciones de los planes Invitado, Gratis y Pro',
  captionFree: 'Funciones de los planes Gratis y Pro',
  calendarSync: 'Sincronización con el calendario',
  calendarExport: 'Exportar al calendario',
  linkedCalendars: 'Calendarios vinculados, siempre al día',
  dailyUvPush: 'Aviso diario de UV los días que necesitas protección',
  reapplyPush: 'Recordatorios de protector solar con Solara cerrada',
  familyProfiles: 'Perfiles familiares, la persona más sensible primero',
  forecast: 'Pronóstico',
  activities: 'Actividades',
  yourPlan: 'Tu plan',
  thisDevice: 'Este dispositivo',
  synced: 'Sincronizado',
  uvAtEvents: 'UV en tus eventos (.ics)',
  morningAlerts: 'Alertas matutinas y de UV',
  comingSoon: 'Muy pronto',
  tenDayForecast: 'Pronóstico de 10 días',
  billingEnded: 'Tu suscripción a Pro terminó. Estás en el plan Gratis.',
  billingFree: 'Estás en el plan Gratis.',
  proYearly: 'Pro, anual',
  proMonthly: 'Pro, mensual',
  billingStore: 'Pro. Adminístralo en la tienda donde te suscribiste.',
  paymentFailed: plan => `${plan}. Falló tu último pago.`,
  paymentFailedUpdate: plan =>
    `${plan}. Falló tu último pago: actualiza tu forma de pago para conservar Pro.`,
  trialEndsNoRenew: (plan, day) => `${plan}. Tu prueba gratis termina el ${day} y no se renovará.`,
  trialEnds: (plan, day) =>
    `${plan}. Tu prueba gratis termina el ${day}; ese día se cobra el primer pago.`,
  canceledUntil: (plan, day) => punto(`${plan}. Cancelado: Pro sigue hasta el ${day}`),
  renewsOn: (plan, day) => punto(`${plan}. Se renueva el ${day}`),
  planOnly: plan => `${plan}.`,
  accountServicesUnavailable: 'Los servicios de la cuenta no están disponibles.',
} satisfies Translation<typeof pricing>
