import { describe, expect, it } from 'vitest'
import { FITZPATRICK_TYPES, SKIN_TYPES } from '@solara/core'
import {
  SKIN_QUIZ,
  fitzpatrickTypeForScore,
  skinQuizComplete,
  skinQuizScore,
  skinTypeFromQuiz,
  type SkinQuizAnswers,
} from '@/lib/skin-quiz'

/** Every question answered with the same score. */
const all = (score: number): SkinQuizAnswers =>
  Object.fromEntries(SKIN_QUIZ.map(q => [q.id, score]))

/** Answers whose raw total is `total` (0-20), filled from the first question on. */
function totalling(total: number): SkinQuizAnswers {
  let left = total
  return Object.fromEntries(
    SKIN_QUIZ.map(q => {
      const score = Math.min(4, left)
      left -= score
      return [q.id, score]
    }),
  )
}

describe('the skin type quiz', () => {
  it('asks five questions with five answers each', () => {
    expect(SKIN_QUIZ).toHaveLength(5)
    for (const q of SKIN_QUIZ) expect(q.answers).toHaveLength(5)
    expect(new Set(SKIN_QUIZ.map(q => q.id)).size).toBe(5)
  })

  it('suggests nothing until every question is answered', () => {
    const partial = { ...all(2) }
    delete (partial as Record<string, number>).face
    expect(skinQuizComplete(partial)).toBe(false)
    expect(skinQuizScore(partial)).toBeNull()
    expect(skinTypeFromQuiz(partial)).toBeNull()
    expect(skinTypeFromQuiz({ ...all(2), face: 5 })).toBeNull()
    expect(skinTypeFromQuiz({ ...all(2), face: 1.5 })).toBeNull()
  })

  it("reads the full questionnaire's bands", () => {
    expect([0, 7, 8, 16, 17, 25, 26, 30, 31, 40].map(fitzpatrickTypeForScore)).toEqual([
      'I',
      'I',
      'II',
      'II',
      'III',
      'III',
      'IV',
      'IV',
      'V-VI',
      'V-VI',
    ])
  })

  it('scales five answers to the ten-question total', () => {
    expect(skinQuizScore(all(0))).toBe(0)
    expect(skinQuizScore(all(4))).toBe(40)
    expect(skinQuizScore(totalling(9))).toBe(18)
  })

  it('maps each band to the matching skin type', () => {
    expect(skinTypeFromQuiz(totalling(3))).toBe('very-fair')
    expect(skinTypeFromQuiz(totalling(4))).toBe('fair')
    expect(skinTypeFromQuiz(totalling(8))).toBe('fair')
    expect(skinTypeFromQuiz(totalling(9))).toBe('medium')
    expect(skinTypeFromQuiz(totalling(12))).toBe('medium')
    expect(skinTypeFromQuiz(totalling(13))).toBe('olive')
    expect(skinTypeFromQuiz(totalling(15))).toBe('olive')
    expect(skinTypeFromQuiz(totalling(16))).toBe('dark')
    expect(skinTypeFromQuiz(all(4))).toBe('dark')
  })

  it('names a Fitzpatrick type for every skin type, in order', () => {
    expect(SKIN_TYPES.map(skin => FITZPATRICK_TYPES[skin])).toEqual([
      'I',
      'II',
      'III',
      'IV',
      'V-VI',
    ])
  })
})
