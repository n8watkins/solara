import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '@solara/core/i18n'
import keywords from '@/messages/icon-search'
import iconSearchEs from '@/messages/es/icon-search'
import editorEs from '@/messages/es/editor'
import { EMOJI_GROUPS, searchEmojis } from './emoji-catalog'

afterEach(() => setLocale('en'))

describe('EMOJI_GROUPS', () => {
  it('gives every emoji search words, in lower case, and no group a duplicate', () => {
    const all = new Set(EMOJI_GROUPS.flatMap(group => group.emojis))
    expect(Object.keys(keywords).sort()).toEqual([...all].sort())
    for (const group of EMOJI_GROUPS) {
      expect(new Set(group.emojis).size, group.name).toBe(group.emojis.length)
    }
    for (const [emoji, words] of Object.entries({ ...keywords, ...iconSearchEs })) {
      expect(words.trim(), emoji).not.toBe('')
      expect(words, emoji).toBe(words.toLowerCase())
    }
  })
})

describe('searchEmojis', () => {
  it('matches keyword prefixes in catalog order', () => {
    expect(searchEmojis('bike')).toEqual(['🚴', '🚵'])
    expect(searchEmojis('Sunscr')).toEqual(['🧴'])
  })

  it('matches a group name and lists each emoji once', () => {
    const sky = searchEmojis('sun & sky')
    expect(sky).toContain('☀️')
    expect(new Set(sky).size).toBe(sky.length)
    const water = searchEmojis('water')
    expect(water.filter(e => e === '💧')).toHaveLength(1)
  })

  it('finds Spanish words in Spanish, with or without accents, and still the English ones', () => {
    expect(searchEmojis('natación')).toEqual([])
    setLocale('es', { iconSearch: iconSearchEs, editor: editorEs })
    expect(searchEmojis('natación')).toEqual(['🏊'])
    expect(searchEmojis('NATACION')).toEqual(['🏊'])
    expect(searchEmojis('bici')).toEqual(['🚴', '🚵'])
    expect(searchEmojis('protector')).toEqual(['🧴'])
    expect(searchEmojis('tenis de m')).toEqual(['🏓'])
    expect(searchEmojis('futbol')).toEqual(['⚽', '🏈'])
    // A group by its Spanish name.
    expect(searchEmojis('animales')).toContain('🦊')
    // English still works for a Spanish speaker who types it.
    expect(searchEmojis('bike')).toEqual(['🚴', '🚵'])
  })

  it('matches the emoji itself and nothing for a blank query', () => {
    expect(searchEmojis('🐬')).toEqual(['🐬'])
    expect(searchEmojis('  ')).toEqual([])
    expect(searchEmojis('zzz')).toEqual([])
  })
})
