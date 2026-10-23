// Type boundary for ics.js, which is not yet type-checked (it moves to TypeScript with the
// rest of functions/ in plan lane W2-B). Keep in sync with ics.js.

export interface IcsEvent {
  uid: string
  summary: string
  description: string
  dateStr: string
  start: number
  end: number
}

export function buildICS(events: IcsEvent[], now?: Date): string
export function escapeText(value: unknown): string
export function validActivityId(id: unknown): boolean
