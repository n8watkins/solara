/**
 * Cloud attenuation of UV.
 *
 * Cloud cover lowers ground-level UV, but weakly and never to zero — even fully
 * overcast skies pass a large share of UV (which is why people burn on cloudy days).
 * We model this conservatively:
 *   - thin/partial cloud (≤40%) → no discount at all (don't falsely green-light)
 *   - 40%→100% cover ramps the discount linearly up to a max of 30%
 *   - the result is never greater than the input UV
 *
 * This is deliberately cautious: it under-promises safety. It exists only to let a
 * borderline-high hour qualify when skies are genuinely heavy, not to make peak sun safe.
 */
export function cloudAdjustedUV(uv: number, cloudCover?: number): number {
  if (cloudCover == null || cloudCover <= 40) return uv
  const frac = Math.min(1, (cloudCover - 40) / 60) // 0 at 40%, 1 at 100%
  const factor = 1 - 0.3 * frac // 1.0 → 0.7
  return Math.round(uv * factor * 10) / 10
}
