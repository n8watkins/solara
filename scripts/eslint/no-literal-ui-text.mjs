// ESLint rule: no user-visible English written into components (ROADMAP item 46,
// docs/i18n/README.md). Text in JSX, and string literals in the attributes people read or
// hear (aria-label, title, placeholder, alt and the props that carry such text), must come
// from a message catalogue (messages/*.ts), so every language shows it.
//
// What counts as words: two or more letters in a row. Brand and unit names that read the
// same in every language (Solara, UV, Pro, SPF, Google Calendar, Outlook ...) are allowed.

/** Attributes whose value is read or heard by people. */
const TEXT_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'aria-roledescription',
  'title',
  'placeholder',
  'alt',
  'label',
  'ariaLabel',
  'description',
  'summary',
  'heading',
  'cta',
  'help',
  'empty',
  'detail',
  'note',
  'body',
  'text',
])

/** Words that are the same in every language Solara speaks. */
const ALLOWED = new Set([
  'Solara',
  'UV',
  'Pro',
  'SPF',
  'Google',
  'Google Calendar',
  'Outlook',
  'Open-Meteo',
  'GeoNames',
  'OpenStreetMap',
  'CC BY 4.0',
  'iCloud',
  'Yahoo',
  'Stripe',
  'OK',
])

const WORDS = /\p{L}{2,}/u

function isWords(text) {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  // An address shown as an example ("https://… or webcal://…") reads the same everywhere.
  if (!trimmed || !WORDS.test(trimmed) || trimmed.includes('://')) return false
  return !ALLOWED.has(trimmed.replace(/&nbsp;| /g, ' '))
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow user-visible text written into components; use a message catalogue.',
    },
    messages: {
      literal:
        'User-visible text "{{text}}" belongs in a message catalogue (messages/*.ts), so every language shows it (docs/i18n/README.md).',
    },
    schema: [],
  },
  create(context) {
    const report = (node, text) =>
      context.report({ node, messageId: 'literal', data: { text: text.trim().slice(0, 60) } })
    return {
      JSXText(node) {
        if (isWords(node.value)) report(node, node.value)
      },
      JSXAttribute(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : null
        if (!name || !TEXT_ATTRIBUTES.has(name) || !node.value) return
        const value = node.value
        if (value.type === 'Literal' && typeof value.value === 'string' && isWords(value.value)) {
          report(value, value.value)
        }
        if (value.type === 'JSXExpressionContainer') {
          const expression = value.expression
          if (expression.type === 'Literal' && typeof expression.value === 'string') {
            if (isWords(expression.value)) report(expression, expression.value)
          } else if (expression.type === 'TemplateLiteral') {
            const text = expression.quasis.map(q => q.value.cooked ?? '').join(' ')
            if (isWords(text)) report(expression, text)
          }
        }
      },
    }
  },
}

export default rule
