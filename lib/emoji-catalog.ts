/**
 * The icons the activity emoji picker offers, in groups. An emoji can appear in more
 * than one group. Its search words are in the message catalogue, in the page's language
 * (messages/icon-search.ts).
 */
import { currentLocale } from '@solara/core/i18n'
import m from '@/messages/editor'
import keywords, { englishIconKeywords } from '@/messages/icon-search'

export interface EmojiGroup {
  /** Group name, a stable key (English). */
  name: string
  /** The name shown with `icon` as the heading, in the page's language. */
  readonly label: string
  icon: string
  emojis: readonly string[]
}

export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    name: 'Active',
    get label() {
      return m.groupActive
    },
    icon: '🏃',
    emojis: [
      '🏃',
      '🚴',
      '🏊',
      '🏄',
      '🧘',
      '🤸',
      '🏋️',
      '⛹️',
      '🤾',
      '🏇',
      '🚵',
      '🤺',
      '🏌️',
      '🎿',
      '🏂',
      '🛹',
      '🧗',
      '🤼',
      '🏆',
      '🥇',
    ],
  },
  {
    name: 'Sports',
    get label() {
      return m.groupSports
    },
    icon: '⚽',
    emojis: [
      '⚽',
      '🏀',
      '🏈',
      '⚾',
      '🥎',
      '🎾',
      '🏐',
      '🏉',
      '🥏',
      '🏸',
      '🏒',
      '🏑',
      '🥍',
      '🏓',
      '🥊',
      '🎯',
      '🏹',
      '🎣',
      '🤿',
    ],
  },
  {
    name: 'Nature',
    get label() {
      return m.groupNature
    },
    icon: '🌿',
    emojis: [
      '🌿',
      '🌱',
      '🌲',
      '🌳',
      '🌴',
      '🌵',
      '🍀',
      '🌾',
      '🌻',
      '🌸',
      '🌺',
      '🍁',
      '🍂',
      '🍃',
      '🌊',
      '🏔️',
      '🗻',
      '🏕️',
      '🌅',
      '🌄',
    ],
  },
  {
    name: 'Sun & sky',
    get label() {
      return m.groupSunSky
    },
    icon: '☀️',
    emojis: [
      '☀️',
      '🌤️',
      '⛅',
      '🌈',
      '🌊',
      '🏖️',
      '🏝️',
      '⛰️',
      '🌋',
      '🗺️',
      '🧭',
      '⛺',
      '🔥',
      '💧',
      '❄️',
      '🌬️',
      '🌪️',
      '🌫️',
      '🌡️',
      '⚡',
    ],
  },
  {
    name: 'Animals',
    get label() {
      return m.groupAnimals
    },
    icon: '🐾',
    emojis: [
      '🐕',
      '🐈',
      '🐦',
      '🦅',
      '🦁',
      '🐺',
      '🦊',
      '🐻',
      '🐼',
      '🐨',
      '🦋',
      '🐝',
      '🐛',
      '🦎',
      '🐸',
      '🐬',
      '🦈',
      '🐙',
      '🦀',
      '🦜',
    ],
  },
  {
    name: 'Food & drink',
    get label() {
      return m.groupFood
    },
    icon: '🥗',
    emojis: [
      '🥗',
      '🍉',
      '🍓',
      '🫐',
      '🍎',
      '🍊',
      '🍋',
      '🌽',
      '🥕',
      '🥦',
      '☕',
      '🧃',
      '💧',
      '🧊',
      '🫖',
      '🍵',
      '🥤',
      '🍹',
      '🍦',
      '🧁',
    ],
  },
  {
    name: 'Gear',
    get label() {
      return m.groupGear
    },
    icon: '🎒',
    emojis: [
      '🎒',
      '👟',
      '🧢',
      '🕶️',
      '🧣',
      '🧤',
      '🧦',
      '👗',
      '🩱',
      '🩲',
      '🩳',
      '👒',
      '⛑️',
      '🌂',
      '☂️',
      '🔦',
      '🧴',
      '💊',
      '🩺',
      '🏷️',
    ],
  },
  {
    name: 'Other',
    get label() {
      return m.groupOther
    },
    icon: '✨',
    emojis: [
      '✨',
      '⭐',
      '🌟',
      '💫',
      '🔥',
      '💥',
      '🎉',
      '🎊',
      '🎈',
      '🎁',
      '💪',
      '🙌',
      '👋',
      '✌️',
      '🤙',
      '👏',
      '🙏',
      '💚',
      '🧡',
      '❤️',
    ],
  },
]

/** Lower case without accents, so "natacion" finds "natación". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** An icon's search words in the page's language, and in English too in another language. */
export function iconKeywords(emoji: string): string[] {
  const own = (keywords as Record<string, string | undefined>)[emoji] ?? ''
  const english = currentLocale() === 'en' ? '' : (englishIconKeywords[emoji] ?? '')
  return `${own} ${english}`.split(' ').filter(Boolean).map(fold)
}

/**
 * Emojis matching `query`, without duplicates: the emoji itself, the start of one of its
 * words ("bici" or "bicicleta de montaña"), or its group's name. Case and accents do not
 * matter. A blank query matches nothing.
 */
export function searchEmojis(
  query: string,
  groups: readonly EmojiGroup[] = EMOJI_GROUPS,
): string[] {
  const q = fold(query.trim())
  if (!q) return []
  const found = new Set<string>()
  for (const group of groups) {
    const groupMatches = fold(group.name).includes(q) || fold(group.label).includes(q)
    for (const emoji of group.emojis) {
      if (groupMatches || emoji.includes(query.trim()) || matchesWords(iconKeywords(emoji), q))
        found.add(emoji)
    }
  }
  return [...found]
}

/** Whether `q` starts one of the words, or a run of them ("tenis de m"). */
function matchesWords(words: readonly string[], q: string): boolean {
  return words.some((_, i) => words.slice(i).join(' ').startsWith(q))
}
