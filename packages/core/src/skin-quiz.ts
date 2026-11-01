// The optional skin type quiz (components/SkinTypeQuiz.tsx): five questions from the
// standard Fitzpatrick skin type questionnaire, scored the standard way.
//
// The full questionnaire has ten questions, each answered on a 0-4 scale, and reads
// the total (0-40) against fixed bands: 0-7 type I, 8-16 type II, 17-25 type III,
// 26-30 type IV, over 30 types V-VI (for example the Fitzpatrick Skin Type Worksheet
// published by the North Carolina Department of Health and Human Services, Radiation
// Protection Section). Solara asks the five questions about the skin itself and how it
// reacts to the sun, with the questionnaire's own answers and points, and leaves out
// eye and hair color and the three questions about recent tanning and treatment areas,
// which are for clinics. The five answers are scaled to the full questionnaire's range
// (times 10 / 5) and read against the same bands.
//
// It is a planning estimate, not a medical assessment; the quiz says so.
import {
  FITZPATRICK_TYPES,
  SKIN_TYPES,
  type FitzpatrickType,
  type SkinType,
} from './recommendation'
import m from './messages/skin-quiz'

export interface SkinQuizQuestion {
  id: string
  question: string
  /** Answers in the questionnaire's order; each scores its position (0-4). */
  answers: readonly [string, string, string, string, string]
}

const QUESTION_IDS = ['unexposed', 'freckles', 'burn', 'tan', 'face'] as const

/** The questions, read in the page's language when used. */
export const SKIN_QUIZ: readonly SkinQuizQuestion[] = QUESTION_IDS.map(id => ({
  id,
  get question() {
    return m[id]
  },
  get answers() {
    return m[`${id}Answers`].split('|') as unknown as SkinQuizQuestion['answers']
  },
}))

/** Questions in the full questionnaire, whose total the bands below read. */
const FULL_QUESTIONNAIRE = 10

/** The highest total of each band in the full questionnaire, lightest type first. */
const BANDS: readonly { max: number; type: FitzpatrickType }[] = [
  { max: 7, type: 'I' },
  { max: 16, type: 'II' },
  { max: 25, type: 'III' },
  { max: 30, type: 'IV' },
  { max: Infinity, type: 'V-VI' },
]

/** Answers by question id: the chosen answer's index (0-4). */
export type SkinQuizAnswers = Readonly<Record<string, number>>

/** Whether every question has a valid answer. */
export function skinQuizComplete(answers: SkinQuizAnswers): boolean {
  return SKIN_QUIZ.every(
    q => Number.isInteger(answers[q.id]) && answers[q.id]! >= 0 && answers[q.id]! <= 4,
  )
}

/** The answers' total on the full questionnaire's 0-40 scale, or null until all are answered. */
export function skinQuizScore(answers: SkinQuizAnswers): number | null {
  if (!skinQuizComplete(answers)) return null
  const total = SKIN_QUIZ.reduce((sum, q) => sum + answers[q.id]!, 0)
  return (total * FULL_QUESTIONNAIRE) / SKIN_QUIZ.length
}

/** The Fitzpatrick type a full-questionnaire total falls in. */
export function fitzpatrickTypeForScore(score: number): FitzpatrickType {
  return BANDS.find(band => score <= band.max)!.type
}

/** The skin type the answers suggest, or null until every question is answered. */
export function skinTypeFromQuiz(answers: SkinQuizAnswers): SkinType | null {
  const score = skinQuizScore(answers)
  if (score === null) return null
  const type = fitzpatrickTypeForScore(score)
  return SKIN_TYPES.find(skin => FITZPATRICK_TYPES[skin] === type) ?? null
}
