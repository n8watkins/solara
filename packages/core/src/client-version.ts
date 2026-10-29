// Which client build called a Function: every call sends `X-Solara-Client:
// <platform>/<version>` (the web app's is `web/<commit>`; a native app would send
// `android/1.4.0`). The Functions log it now (functions/src/shared/http.ts), so that a
// too-old native build can later be refused with a clear "update the app" answer
// instead of failing on a changed contract.

/** The request header that names the client build. */
export const CLIENT_VERSION_HEADER = 'X-Solara-Client'

export const CLIENT_PLATFORMS = Object.freeze(['web', 'android', 'ios'] as const)
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number]

export interface ClientVersion {
  platform: ClientPlatform
  /** A build version or commit: letters, digits and . _ + -, at most 40 characters. */
  version: string
}

const PATTERN = /^(web|android|ios)\/([A-Za-z0-9._+-]{1,40})$/

/** The header value for a build, or null when the version cannot be sent as one. */
export function clientVersionHeader(platform: ClientPlatform, version: string): string | null {
  const value = `${platform}/${version}`
  return PATTERN.test(value) ? value : null
}

/** The client build a request names, or null for a missing or malformed header. */
export function parseClientVersion(value: unknown): ClientVersion | null {
  if (typeof value !== 'string') return null
  const match = PATTERN.exec(value)
  if (!match?.[1] || !match[2]) return null
  return { platform: match[1] as ClientPlatform, version: match[2] }
}
