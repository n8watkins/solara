import { describe, expect, it } from 'vitest'
import { nearestInAdjacentRow, nextIndex, shiftIntoView } from './roving-focus'

describe('nextIndex', () => {
  it('moves forward and back on both arrow axes, wrapping by default', () => {
    expect(nextIndex('ArrowRight', 0, 5)).toBe(1)
    expect(nextIndex('ArrowDown', 4, 5)).toBe(0)
    expect(nextIndex('ArrowLeft', 0, 5)).toBe(4)
    expect(nextIndex('ArrowUp', 3, 5)).toBe(2)
  })

  it('stops at the ends without wrapping', () => {
    expect(nextIndex('ArrowRight', 4, 5, { wrap: false })).toBe(4)
    expect(nextIndex('ArrowLeft', 0, 5, { wrap: false })).toBe(0)
  })

  it('jumps with Home and End and ignores other keys', () => {
    expect(nextIndex('Home', 3, 5)).toBe(0)
    expect(nextIndex('End', 1, 5)).toBe(4)
    expect(nextIndex('Enter', 1, 5)).toBeNull()
    expect(nextIndex('ArrowRight', 0, 0)).toBeNull()
  })
})

describe('nearestInAdjacentRow', () => {
  // Two groups: a row of three, a short row of one, then a new group's row.
  const boxes = [
    { left: 0, top: 0 },
    { left: 34, top: 0 },
    { left: 68, top: 0 },
    { left: 0, top: 34 },
    { left: 0, top: 90 },
    { left: 34, top: 90.5 },
    { left: 68, top: 90 },
  ]

  it('picks the horizontally nearest item in the next row', () => {
    expect(nearestInAdjacentRow(boxes, 2, true)).toBe(3)
    expect(nearestInAdjacentRow(boxes, 3, true)).toBe(4)
  })

  it('picks the nearest item in the previous row, across sub-pixel offsets', () => {
    expect(nearestInAdjacentRow(boxes, 3, false)).toBe(0)
    expect(nearestInAdjacentRow([...boxes, { left: 34, top: 120 }], 7, false)).toBe(5)
  })

  it('returns null at the edges or for an unknown index', () => {
    expect(nearestInAdjacentRow(boxes, 1, false)).toBeNull()
    expect(nearestInAdjacentRow(boxes, 6, true)).toBeNull()
    expect(nearestInAdjacentRow(boxes, 99, true)).toBeNull()
  })
})

describe('shiftIntoView', () => {
  it('leaves a box that fits alone', () => {
    expect(shiftIntoView(100, 200, 390)).toBe(0)
  })

  it('pushes a box off the left edge to the right', () => {
    expect(shiftIntoView(-30, 200, 390)).toBe(38)
  })

  it('pulls a box off the right edge to the left', () => {
    expect(shiftIntoView(250, 200, 390)).toBe(-68)
  })
})
