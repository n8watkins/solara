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
    `Unas ${teaspoons} ${plural(teaspoons, { one: 'cucharadita', other: 'cucharaditas' })} (${ml}${NBSP}mL), un vasito de licor, para todo el cuerpo`,
  amountShort: (teaspoons, areas) => `unas ${teaspoons} cdtas. para ${areas}`,
  amountShortWholeBody: teaspoons => `unas ${teaspoons} cdtas., todo el cuerpo`,
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
]
