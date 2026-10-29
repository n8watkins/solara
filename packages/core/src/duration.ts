// How Solara writes a span of minutes, in every sentence and label (REVIEW9 QA L3): "45 min",
// "2 h", "2 h 47 min", never "167m" (which reads as metres), "1.5h" or "1 hr".

/** "45 min", "2 h", "1 h 30 min", from whole minutes (rounded). */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}
