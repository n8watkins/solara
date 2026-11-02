// Sunscreen coaching (sunscreen.ts, sources in docs/SUNSCREEN.md): the timer's guide,
// the activity cards and Settings. Its own namespace, so it loads with them.
import { defineMessages, plural } from '../i18n'

const NBSP = '\u00a0'

export default defineMessages('sunscreen', {
  // The reapply reminder (reapply.ts), the same in the browser and the server's push.
  reminderTitle: 'Time to reapply sunscreen',
  reminderWater: (minutes: number) =>
    `It has been ${minutes} minutes of swimming or sweating since you put it on.`,
  reminderStandard: (hours: number) => `It has been ${hours} hours since you put it on.`,
  areaFace: 'face',
  areaArms: 'arms',
  areaLegs: 'legs',
  areaTorso: 'body',
  amountText: (teaspoons: number, ml: number, areas: string) =>
    `About ${teaspoons} ${plural(teaspoons, { one: 'teaspoon', other: 'teaspoons' })} (${ml}${NBSP}mL) for your ${areas}`,
  amountTextWholeBody: (teaspoons: number, ml: number) =>
    `About ${teaspoons} ${plural(teaspoons, { one: 'teaspoon', other: 'teaspoons' })} (${ml}${NBSP}mL), a shot glass, for your whole body`,
  amountShort: (teaspoons: number, areas: string) => `about ${teaspoons} tsp for ${areas}`,
  amountShortWholeBody: (teaspoons: number) => `about ${teaspoons} tsp, whole body`,
  /** Joins the parts on a card's row: "face, arms, legs". */
  amountShortList: (areas: string[]) => areas.join(', '),
  teaspoonRule: `About 1 teaspoon (5${NBSP}mL) for each part: face, neck and ears; each arm; each leg; the front of your body; the back of your body.`,
  spfLowUv: (reading: string, from: number) =>
    `UV peaks at ${reading} today: most people need no sunscreen below UV ${from}.`,
  spfVeryHigh: (reading: string) => `SPF 50+ broad spectrum: UV reaches ${reading} today.`,
  spfFairSkin: (reading: string, type: string) =>
    `SPF 50+ broad spectrum: UV reaches ${reading} today, and type ${type} skin burns easily.`,
  spfStandard: (reading: string) => `SPF 30+ broad spectrum: UV reaches ${reading} today.`,
  spfRuleFair: (type: string, from: number) =>
    `With type ${type} skin, use SPF 50+ broad spectrum whenever UV is ${from} or more.`,
  spfRule: (from: number, shadeFrom: number) =>
    `Use SPF 30+ broad spectrum whenever UV is ${from} or more, and SPF 50+ when it reaches ${shadeFrom}.`,
  reapplyRule: (before: string, every: string) =>
    `Put it on ${before} before you go out. Reapply every ${every}, and straight after swimming, sweating or towelling off.`,
  // What else to wear by UV level, "slip, slop, slap, seek, slide" (sun-safety.ts).
  gearProtect: 'Add a shirt, a hat and sunglasses, and shade at midday.',
  gearShade: 'Add a shirt, a hat and sunglasses, and stay in the shade around midday.',
  gearRule: (from: number, shadeFrom: number) =>
    `From UV ${from}, also wear a shirt, a hat and sunglasses; from UV ${shadeFrom}, stay in the shade around midday.`,
  // An activity's fit with its burn time (sun-safety.ts burnFit), on its card and the hero.
  fitsNoBurn: 'Fits without sunscreen: the UV is too low to burn.',
  fitsUnprotected: (burn: string) => `Fits without sunscreen: you'd burn in about ${burn}.`,
  /** From UV 3 the guidance advises sunscreen whatever the duration: one instruction. */
  fitsUnprotectedProtect: (burn: string, spf: number) =>
    `Use SPF${NBSP}${spf}+ at this UV: without it you'd burn in about ${burn}.`,
  fitsWithSunscreen: (burn: string, spf: number, every: string | null) =>
    `Fits with SPF${NBSP}${spf}+${every ? `, reapplied every ${every}` : ''}: without it you'd burn in about ${burn}.`,
  tooLongMove: (spf: number, burn: string, range: string) =>
    // A time such as "5:45 p.m." already ends the sentence.
    `Too long even with SPF${NBSP}${spf}+ (you'd burn in about ${burn}): split it, or move it to ${range}${range.endsWith('.') ? '' : '.'}`,
  tooLongSplit: (spf: number, burn: string) =>
    `Too long even with SPF${NBSP}${spf}+ (you'd burn in about ${burn}): split it into shorter sessions.`,
})
