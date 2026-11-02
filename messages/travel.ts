// The travel prompt (ROADMAP item 53): a calm banner when the device is far from the place
// shown, loaded only when it shows. English, the source of truth; translations in ./es.
import { defineMessages } from '@solara/core/i18n'

export default defineMessages('travel', {
  seemToBeIn: (place: string) => `You seem to be in ${place}. Show UV here?`,
  switchHere: 'Switch',
  notNow: 'Not now',
})
