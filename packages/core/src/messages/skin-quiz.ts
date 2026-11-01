// The Fitzpatrick skin type questionnaire (skin-quiz.ts): each question and its five
// answers in the questionnaire's order, joined by "|".
import { defineMessages } from '../i18n'

export default defineMessages('skinQuiz', {
  unexposed: 'What color is your skin where the sun rarely reaches it?',
  unexposedAnswers: 'Reddish|Very pale|Pale with a beige tint|Light brown|Dark brown',
  freckles: 'Do you have freckles on skin the sun reaches?',
  frecklesAnswers: 'Many|Several|A few|Hardly any|None',
  burn: 'What happens when you stay in the sun too long?',
  burnAnswers:
    'Painful redness, blistering and peeling|Blistering, then peeling|Sometimes a burn, then peeling|Rarely a burn|Never a burn',
  tan: 'How much do you tan?',
  tanAnswers:
    'Hardly or not at all|A light tan|A reasonable tan|I tan very easily|I turn dark brown quickly',
  face: 'How does your face react to the sun?',
  faceAnswers: 'Very sensitive|Sensitive|Normal|Very resistant|Never had a problem',
})
