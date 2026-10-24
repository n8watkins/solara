/** Minimum gap between a floating panel and the viewport edge, in CSS pixels. */
export const VIEWPORT_GUTTER = 12

/**
 * How far to move a panel that opens left-aligned under its anchor so it stays
 * inside the viewport with a gutter on both sides. Returns the horizontal offset
 * from the anchor's left edge (0 when it already fits). A panel wider than the
 * viewport keeps the left gutter.
 */
export function clampShift(
  anchorLeft: number,
  panelWidth: number,
  viewportWidth: number,
  gutter = VIEWPORT_GUTTER,
): number {
  const maxLeft = viewportWidth - gutter - panelWidth
  const target = Math.max(gutter, Math.min(anchorLeft, maxLeft))
  return target - anchorLeft
}
