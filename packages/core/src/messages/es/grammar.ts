// Small pieces of Spanish grammar the translations share.

/**
 * A clock time after "a" or "de": "la 1 p.m." but "las 3 p.m." and "las 13:00", since
 * one o'clock is singular ("a la una").
 */
export function las(time: string): string {
  return /^1(?!\d)/.test(time) ? `la ${time}` : `las ${time}`
}

/**
 * A sentence's closing period, unless it already ends in one: Spanish times and some
 * dates end in an abbreviation ("1 p.m."), whose period also closes the sentence.
 */
export function punto(text: string): string {
  return text.endsWith('.') ? text : `${text}.`
}
