/**
 * A range of two formatted times or dates, punctuated one way everywhere (REVIEW9 QA L4,
 * REVIEW10 QA L5): an en dash, closed up between single words ("9am–10:30am") and spaced
 * when either side has a space ("2 p.m. – 5 p.m.", "Sat 9pm – Sun 1am", "Jun 28 – Jul 4"),
 * with no-break spaces, so a range never breaks around its dash. After "from", write
 * "from 9am to 11am" instead.
 */
export function timeRange(from: string, to: string): string {
  return /\s/.test(from) || /\s/.test(to) ? `${from} – ${to}` : `${from}–${to}`
}
