/**
 * The icons the activity emoji picker offers, in groups, each with search
 * keywords. An emoji can appear in more than one group.
 */
export interface EmojiGroup {
  /** Group name, shown with `icon` as the heading. */
  name: string
  icon: string
  /** [emoji, space-separated keywords]. */
  emojis: readonly (readonly [string, string])[]
}

export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    name: 'Active',
    icon: '🏃',
    emojis: [
      ['🏃', 'run running jog'],
      ['🚴', 'bike bicycle cycling'],
      ['🏊', 'swim swimming pool'],
      ['🏄', 'surf surfing wave'],
      ['🧘', 'yoga meditation stretch'],
      ['🤸', 'gymnastics cartwheel stretch'],
      ['🏋️', 'weights lifting gym workout'],
      ['⛹️', 'basketball ball'],
      ['🤾', 'handball ball'],
      ['🏇', 'horse riding racing'],
      ['🚵', 'mountain bike biking trail'],
      ['🤺', 'fencing'],
      ['🏌️', 'golf'],
      ['🎿', 'ski skiing snow'],
      ['🏂', 'snowboard snow'],
      ['🛹', 'skateboard skate'],
      ['🧗', 'climb climbing bouldering'],
      ['🤼', 'wrestling'],
      ['🏆', 'trophy win'],
      ['🥇', 'medal gold first'],
    ],
  },
  {
    name: 'Sports',
    icon: '⚽',
    emojis: [
      ['⚽', 'soccer football ball'],
      ['🏀', 'basketball ball'],
      ['🏈', 'american football ball'],
      ['⚾', 'baseball ball'],
      ['🥎', 'softball ball'],
      ['🎾', 'tennis ball'],
      ['🏐', 'volleyball beach ball'],
      ['🏉', 'rugby ball'],
      ['🥏', 'frisbee disc'],
      ['🏸', 'badminton'],
      ['🏒', 'hockey ice'],
      ['🏑', 'field hockey'],
      ['🥍', 'lacrosse'],
      ['🏓', 'ping pong table tennis'],
      ['🥊', 'boxing'],
      ['🎯', 'darts target'],
      ['🏹', 'archery bow'],
      ['🎣', 'fishing'],
      ['🤿', 'snorkel diving'],
    ],
  },
  {
    name: 'Nature',
    icon: '🌿',
    emojis: [
      ['🌿', 'herb leaf plant'],
      ['🌱', 'seedling garden plant'],
      ['🌲', 'evergreen tree forest'],
      ['🌳', 'tree park'],
      ['🌴', 'palm tree beach'],
      ['🌵', 'cactus desert'],
      ['🍀', 'clover luck'],
      ['🌾', 'wheat field'],
      ['🌻', 'sunflower flower garden'],
      ['🌸', 'blossom flower'],
      ['🌺', 'hibiscus flower'],
      ['🍁', 'maple leaf autumn'],
      ['🍂', 'leaves autumn fall'],
      ['🍃', 'leaves wind'],
      ['🌊', 'wave ocean sea water'],
      ['🏔️', 'mountain snow peak'],
      ['🗻', 'mountain fuji'],
      ['🏕️', 'camping tent'],
      ['🌅', 'sunrise sea'],
      ['🌄', 'sunrise mountains'],
    ],
  },
  {
    name: 'Sun & sky',
    icon: '☀️',
    emojis: [
      ['☀️', 'sun sunny'],
      ['🌤️', 'sun cloud'],
      ['⛅', 'cloud sun'],
      ['🌈', 'rainbow'],
      ['🌊', 'wave ocean sea water'],
      ['🏖️', 'beach umbrella'],
      ['🏝️', 'island beach'],
      ['⛰️', 'mountain hike'],
      ['🌋', 'volcano'],
      ['🗺️', 'map travel'],
      ['🧭', 'compass navigation'],
      ['⛺', 'tent camping'],
      ['🔥', 'fire campfire hot'],
      ['💧', 'water drop'],
      ['❄️', 'snow cold'],
      ['🌬️', 'wind'],
      ['🌪️', 'tornado storm'],
      ['🌫️', 'fog'],
      ['🌡️', 'thermometer temperature heat'],
      ['⚡', 'lightning energy'],
    ],
  },
  {
    name: 'Animals',
    icon: '🐾',
    emojis: [
      ['🐕', 'dog walk'],
      ['🐈', 'cat'],
      ['🐦', 'bird'],
      ['🦅', 'eagle bird'],
      ['🦁', 'lion'],
      ['🐺', 'wolf'],
      ['🦊', 'fox'],
      ['🐻', 'bear'],
      ['🐼', 'panda'],
      ['🐨', 'koala'],
      ['🦋', 'butterfly'],
      ['🐝', 'bee'],
      ['🐛', 'bug caterpillar'],
      ['🦎', 'lizard'],
      ['🐸', 'frog'],
      ['🐬', 'dolphin'],
      ['🦈', 'shark'],
      ['🐙', 'octopus'],
      ['🦀', 'crab beach'],
      ['🦜', 'parrot bird'],
    ],
  },
  {
    name: 'Food & drink',
    icon: '🥗',
    emojis: [
      ['🥗', 'salad'],
      ['🍉', 'watermelon picnic'],
      ['🍓', 'strawberry'],
      ['🫐', 'blueberries'],
      ['🍎', 'apple'],
      ['🍊', 'orange'],
      ['🍋', 'lemon'],
      ['🌽', 'corn'],
      ['🥕', 'carrot'],
      ['🥦', 'broccoli'],
      ['☕', 'coffee'],
      ['🧃', 'juice'],
      ['💧', 'water drop'],
      ['🧊', 'ice'],
      ['🫖', 'teapot tea'],
      ['🍵', 'tea'],
      ['🥤', 'drink cup'],
      ['🍹', 'cocktail drink'],
      ['🍦', 'ice cream'],
      ['🧁', 'cupcake'],
    ],
  },
  {
    name: 'Gear',
    icon: '🎒',
    emojis: [
      ['🎒', 'backpack bag'],
      ['👟', 'sneaker shoe running'],
      ['🧢', 'cap hat'],
      ['🕶️', 'sunglasses'],
      ['🧣', 'scarf'],
      ['🧤', 'gloves'],
      ['🧦', 'socks'],
      ['👗', 'dress'],
      ['🩱', 'swimsuit'],
      ['🩲', 'swim briefs'],
      ['🩳', 'shorts'],
      ['👒', 'sun hat'],
      ['⛑️', 'helmet'],
      ['🌂', 'umbrella'],
      ['☂️', 'umbrella rain'],
      ['🔦', 'flashlight torch'],
      ['🧴', 'sunscreen lotion'],
      ['💊', 'pill medicine'],
      ['🩺', 'stethoscope health'],
      ['🏷️', 'tag label'],
    ],
  },
  {
    name: 'Other',
    icon: '✨',
    emojis: [
      ['✨', 'sparkles'],
      ['⭐', 'star'],
      ['🌟', 'glowing star'],
      ['💫', 'dizzy star'],
      ['🔥', 'fire hot'],
      ['💥', 'boom'],
      ['🎉', 'party'],
      ['🎊', 'confetti party'],
      ['🎈', 'balloon party'],
      ['🎁', 'gift'],
      ['💪', 'strong muscle'],
      ['🙌', 'hands celebrate'],
      ['👋', 'wave hello'],
      ['✌️', 'peace'],
      ['🤙', 'call shaka'],
      ['👏', 'clap'],
      ['🙏', 'thanks pray'],
      ['💚', 'green heart'],
      ['🧡', 'orange heart'],
      ['❤️', 'red heart love'],
    ],
  },
]

/**
 * Emojis matching `query`, without duplicates: the emoji itself, one of its
 * keywords, or its group's name. A blank query matches nothing.
 */
export function searchEmojis(
  query: string,
  groups: readonly EmojiGroup[] = EMOJI_GROUPS,
): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const found = new Set<string>()
  for (const group of groups) {
    const groupMatches = group.name.toLowerCase().includes(q)
    for (const [emoji, keywords] of group.emojis) {
      if (groupMatches || emoji.includes(q) || keywords.split(' ').some(k => k.startsWith(q)))
        found.add(emoji)
    }
  }
  return [...found]
}
