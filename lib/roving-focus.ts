// Keyboard helpers for composite widgets that keep a single tab stop and
// move focus with the arrow keys (tabs, grids). Pure, so they are unit tested.

/**
 * Index to focus after `key` in a one-dimensional list of `count` items, or
 * null when the key does not navigate. Both arrow axes work, so a list that
 * is vertical on desktop and horizontal on phones behaves the same.
 */
export function nextIndex(
  key: string,
  index: number,
  count: number,
  { wrap = true }: { wrap?: boolean } = {},
): number | null {
  if (count <= 0) return null
  const last = count - 1
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return index >= last ? (wrap ? 0 : last) : index + 1
    case 'ArrowLeft':
    case 'ArrowUp':
      return index <= 0 ? (wrap ? last : 0) : index - 1
    case 'Home':
      return 0
    case 'End':
      return last
    default:
      return null
  }
}

export interface Box {
  left: number
  top: number
}

/**
 * In a wrapping grid whose rows can differ in length, the item in the next
 * (`down`) or previous row that sits closest horizontally to `from`, or null
 * at the edge. `tolerance` absorbs sub-pixel differences within a row.
 */
export function nearestInAdjacentRow(
  boxes: readonly Box[],
  from: number,
  down: boolean,
  tolerance = 4,
): number | null {
  const origin = boxes[from]
  if (!origin) return null
  const candidates = boxes
    .map((box, i) => ({ box, i }))
    .filter(({ box }) =>
      down ? box.top > origin.top + tolerance : box.top < origin.top - tolerance,
    )
  if (candidates.length === 0) return null
  const tops = candidates.map(c => c.box.top)
  const rowTop = down ? Math.min(...tops) : Math.max(...tops)
  let best: { i: number; distance: number } | null = null
  for (const { box, i } of candidates) {
    if (Math.abs(box.top - rowTop) > tolerance) continue
    const distance = Math.abs(box.left - origin.left)
    if (!best || distance < best.distance) best = { i, distance }
  }
  return best?.i ?? null
}

/**
 * Horizontal offset that keeps a box of `width` starting at `left` inside
 * [edge, viewport - edge]. Zero when it already fits.
 */
export function shiftIntoView(left: number, width: number, viewport: number, edge = 8): number {
  if (left < edge) return edge - left
  const overflow = left + width - (viewport - edge)
  return overflow > 0 ? -overflow : 0
}
