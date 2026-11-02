// The coordinate rounding every stored or transmitted position goes through, apart
// from the geocoding schemas (./geocoding.ts) so a guest's first screen can use it
// without Valibot (ROADMAP item 52).

/**
 * Coordinates are rounded to 2 decimals (about 1 km) before they leave the
 * device or are stored. That is plenty for a UV forecast and a city name, and it
 * avoids sending or keeping an exact home position.
 */
export const COORDINATE_DECIMALS = 2

export function roundCoordinate(value: number): number {
  const factor = 10 ** COORDINATE_DECIMALS
  // `+ 0` folds -0 into 0 so rounded values compare and serialize cleanly.
  return Math.round(value * factor) / factor + 0
}
