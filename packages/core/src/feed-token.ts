// Calendar feed token policy, shared by the server that mints and resolves
// tokens and the client that displays the subscribe link.
//
// The feed URL carries a bearer token, so only the server mints it: 32 random
// bytes as base64url (43 URL-safe characters, 256 bits of entropy). Tokens from
// the retired client-minted scheme stay valid until they are rotated.

/** Random bytes in a newly minted token. */
export const FEED_TOKEN_BYTES = 32

/** A token minted by the server: 32 bytes as base64url. */
export const FEED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** Tokens from the retired client-minted scheme that the migration may preserve. */
export const LEGACY_FEED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/

/** Whether a value has the shape of a live feed token (current or legacy). */
export function isValidFeedToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    (FEED_TOKEN_PATTERN.test(token) || LEGACY_FEED_TOKEN_PATTERN.test(token))
  )
}
