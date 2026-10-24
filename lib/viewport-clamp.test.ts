import { describe, expect, it } from 'vitest'
import { VIEWPORT_GUTTER, clampShift } from './viewport-clamp'

describe('clampShift', () => {
  it('leaves a panel that fits where it is', () => {
    expect(clampShift(100, 270, 1440)).toBe(0)
  })

  it('pulls a panel that would overflow the right edge back inside the gutter', () => {
    // Anchor at 200 on a 390 px phone: the panel may start at most at 390 - 12 - 270 = 108.
    expect(clampShift(200, 270, 390)).toBe(108 - 200)
  })

  it('pushes a panel off the left edge back to the gutter', () => {
    expect(clampShift(4, 270, 1440)).toBe(VIEWPORT_GUTTER - 4)
  })

  it('keeps the left gutter when the panel is wider than the viewport', () => {
    expect(clampShift(50, 400, 320)).toBe(VIEWPORT_GUTTER - 50)
  })
})
