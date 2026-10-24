import { describe, expect, it } from 'vitest'
import { redact } from './redact'

describe('redact', () => {
  it('removes email addresses, including plus and dotted forms', () => {
    expect(redact('mail jane.doe+uv@mail.example.co.uk now')).toBe('mail [email] now')
    expect(redact('(a@b.io)')).toBe('([email])')
  })

  it('stays fast on long runs of address characters with no @', () => {
    // A quadratic pattern took about 1 s for 50k characters; a linear one takes milliseconds.
    for (const input of ['+'.repeat(100_000), 'a.'.repeat(50_000), `${'x'.repeat(100_000)}@`]) {
      const start = performance.now()
      redact(input)
      expect(performance.now() - start).toBeLessThan(250)
    }
  })
})
