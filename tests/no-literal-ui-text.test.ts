// The lint rule that keeps user-visible English out of components (scripts/eslint/).
import { RuleTester, type Rule } from 'eslint'
import { describe, it } from 'vitest'
import rule from '../scripts/eslint/no-literal-ui-text.mjs'

RuleTester.describe = describe
RuleTester.it = it
const tester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
})

tester.run('no-literal-ui-text', rule as unknown as Rule.RuleModule, {
  valid: [
    'const a = <p>{m.title}</p>',
    'const a = <button aria-label={m.close}>×</button>',
    'const a = <span>UV</span>',
    'const a = <span>Solara</span>',
    'const a = <p className="text-ink flex">{m.body}</p>',
    'const a = <input placeholder="https://… or webcal://…" />',
    'const a = <span>· – ✓ 42</span>',
  ],
  invalid: [
    { code: 'const a = <p>Burn time</p>', errors: [{ messageId: 'literal' }] },
    {
      code: 'const a = <button aria-label="Close settings" />',
      errors: [{ messageId: 'literal' }],
    },
    {
      code: "const a = <input placeholder={'Search a city'} />",
      errors: [{ messageId: 'literal' }],
    },
    { code: 'const a = <img alt={`Photo of ${x}`} />', errors: [{ messageId: 'literal' }] },
    { code: 'const a = <Upsell title="Save your plan" />', errors: [{ messageId: 'literal' }] },
  ],
})
