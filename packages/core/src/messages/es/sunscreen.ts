import { plural, type Translation } from '../../i18n'
import type sunscreen from '../sunscreen'
import { punto } from './grammar'

const NBSP = '\u00a0'

export default {
  reminderTitle: 'Es hora de volver a aplicar protector solar',
  reminderWater: minutes =>
    `Han pasado ${minutes} minutos nadando o sudando desde que te lo aplicaste.`,
  reminderStandard: hours => `Han pasado ${hours} horas desde que te lo aplicaste.`,
  areaFace: 'cara',
  areaArms: 'brazos',
  areaLegs: 'piernas',
  areaTorso: 'cuerpo',
  amountText: (teaspoons, ml, areas) =>
    `Unas ${teaspoons} ${plural(teaspoons, { one: 'cucharadita', other: 'cucharaditas' })} (${ml}${NBSP}mL) para ${areas}`,
  amountTextWholeBody: (teaspoons, ml) =>
    `Unas ${teaspoons} ${plural(teaspoons, { one: 'cucharadita', other: 'cucharaditas' })} (${ml}${NBSP}mL), un caballito (vaso tequilero), para todo el cuerpo`,
  amountShort: (teaspoons, areas) =>
    `unas ${teaspoons} ${plural(teaspoons, { one: 'cucharadita', other: 'cucharaditas' })} para ${areas}`,
  amountShortWholeBody: teaspoons =>
    `unas ${teaspoons} ${plural(teaspoons, { one: 'cucharadita', other: 'cucharaditas' })}, todo el cuerpo`,
  amountShortList: areas => areas.join(', '),
  teaspoonRule: `Más o menos 1 cucharadita (5${NBSP}mL) por cada parte: cara, cuello y orejas; cada brazo; cada pierna; el frente del cuerpo; la espalda.`,
  spfLowUv: (reading, from) =>
    punto(
      `Hoy el UV llega a ${reading}: la mayoría de las personas no necesita protector solar con UV menor de ${from}`,
    ),
  spfVeryHigh: reading => `FPS 50+ de amplio espectro: hoy el UV llega a ${reading}.`,
  spfFairSkin: (reading, type) =>
    `FPS 50+ de amplio espectro: hoy el UV llega a ${reading}, y la piel tipo ${type} se quema con facilidad.`,
  spfStandard: reading => `FPS 30+ de amplio espectro: hoy el UV llega a ${reading}.`,
  spfRuleFair: (type, from) =>
    `Con piel tipo ${type}, usa FPS 50+ de amplio espectro siempre que el UV sea ${from} o más.`,
  spfRule: (from, shadeFrom) =>
    `Usa FPS 30+ de amplio espectro siempre que el UV sea ${from} o más, y FPS 50+ cuando llegue a ${shadeFrom}.`,
  reapplyRule: (before, every) =>
    `Aplícalo ${before} antes de salir. Vuelve a aplicarlo cada ${every}, y justo después de nadar, sudar o secarte con la toalla.`,
  gearProtect: 'Suma una camiseta, un sombrero y lentes de sol, y sombra al mediodía.',
  gearShade:
    'Suma una camiseta, un sombrero y lentes de sol, y quédate a la sombra cerca del mediodía.',
  gearRule: (from, shadeFrom) =>
    `Desde UV ${from}, usa también camiseta, sombrero y lentes de sol; desde UV ${shadeFrom}, quédate a la sombra cerca del mediodía.`,
  fitsNoBurn: 'Puedes hacerlo sin protector solar: el UV es demasiado bajo para quemarte.',
  fitsUnprotected: burn => `Puedes hacerlo sin protector solar: te quemarías en unos ${burn}.`,
  fitsUnprotectedProtect: (burn, spf) =>
    `Puedes hacerlo sin protector solar (te quemarías en unos ${burn}), pero usa FPS${NBSP}${spf}+ con este UV.`,
  fitsWithSunscreen: (burn, spf, every) =>
    `Dura más que tu tiempo hasta quemarte (unos ${burn}): hazlo con FPS${NBSP}${spf}+${every ? `, reaplicado cada ${every}` : ''}.`,
  tooLongMove: (spf, burn, range) =>
    punto(
      `Dura demasiado aun con FPS${NBSP}${spf}+ (te quemarías en unos ${burn}): divídelo o muévelo a ${range}`,
    ),
  tooLongSplit: (spf, burn) =>
    `Dura demasiado aun con FPS${NBSP}${spf}+ (te quemarías en unos ${burn}): divídelo en sesiones más cortas.`,
} satisfies Translation<typeof sunscreen>

export const needsReview: (keyof typeof sunscreen)[] = [
  'reminderTitle',
  'reminderWater',
  'reminderStandard',
  'amountText',
  'amountTextWholeBody',
  'amountShort',
  'amountShortWholeBody',
  'teaspoonRule',
  'spfLowUv',
  'spfVeryHigh',
  'spfFairSkin',
  'spfStandard',
  'spfRuleFair',
  'spfRule',
  'reapplyRule',
  'gearProtect',
  'gearShade',
  'gearRule',
  'fitsNoBurn',
  'fitsUnprotected',
  'fitsUnprotectedProtect',
  'fitsWithSunscreen',
  'tooLongMove',
  'tooLongSplit',
]
