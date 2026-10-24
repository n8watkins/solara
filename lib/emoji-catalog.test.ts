import { describe, expect, it } from 'vitest'
import { EMOJI_GROUPS, searchEmojis } from './emoji-catalog'

describe('EMOJI_GROUPS', () => {
  it('gives every emoji at least one keyword and no group a duplicate', () => {
    for (const group of EMOJI_GROUPS) {
      const emojis = group.emojis.map(([e]) => e)
      expect(new Set(emojis).size, group.name).toBe(emojis.length)
      for (const [emoji, keywords] of group.emojis) {
        expect(keywords.trim(), emoji).not.toBe('')
        expect(keywords, emoji).toBe(keywords.toLowerCase())
      }
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

  it('matches the emoji itself and nothing for a blank query', () => {
    expect(searchEmojis('🐬')).toEqual(['🐬'])
    expect(searchEmojis('  ')).toEqual([])
    expect(searchEmojis('zzz')).toEqual([])
  })
})
