// The client address that per-address limits key on, and a self-check that notices
// when that address is not the client's at all.
//
// Google's front end appends the address a connection came from to X-Forwarded-For;
// everything to its left was sent by the client and can be forged, so only the entry
// TRUSTED_PROXY_HOPS from the right is used. The key is then made coarse enough that
// one person cannot multiply their budget:
//
// - IPv6 addresses are bucketed by their /64 prefix. One ordinary connection gets a
//   whole /64 (2^64 addresses), so keying on the full address would give an attacker a
//   fresh budget per request.
// - IPv4-mapped IPv6 addresses (`::ffff:203.0.113.9`) count as the IPv4 address.
//
// Every limiter that uses this key lives in one instance's memory, so the effective
// limit across a function is `limit x maxInstances` (shared/options.ts). Paths whose
// cost must be bounded globally use a shared counter instead (forecast/upstream-budget.ts).

import { isIP } from 'node:net'

import { logger } from 'firebase-functions/logger'
import type { Request } from 'firebase-functions/v2/https'

/**
 * How many X-Forwarded-For entries, counted from the right, Google's own proxies add.
 * The Functions are called on their Cloud Run URLs with no load balancer or Hosting
 * rewrite in front, and Google's front end appends exactly one entry: the address the
 * connection came from. Everything to its left was sent by the client and can be forged.
 * An external HTTPS load balancer in front would append `<client>,<load balancer>`,
 * making this 2; change it together with any such change to how the Functions are served.
 * The self-check below (ProxyHopMonitor) and infra/check-client-address.sh catch a
 * wrong value.
 */
export const TRUSTED_PROXY_HOPS = 1

/** The prefix length IPv6 clients are bucketed by. */
export const IPV6_BUCKET_PREFIX = 64

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(address: string): number[] | null {
  if (isIP(address) !== 6) return null
  let text = address.split('%')[0] ?? ''
  // A trailing dotted IPv4 part (`::ffff:1.2.3.4`) is two groups.
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text)
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number]
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head = '', tail] = text.split('::')
  const parse = (part: string) => (part ? part.split(':').map(group => parseInt(group, 16)) : [])
  const left = parse(head)
  const right = tail === undefined ? [] : parse(tail)
  const fill = 8 - left.length - right.length
  if (fill < 0 || (tail === undefined && fill !== 0)) return null
  return [...left, ...new Array<number>(fill).fill(0), ...right]
}

/**
 * The key per-address limits use for an address: an IPv4 address as is, an IPv4-mapped
 * IPv6 address as its IPv4 address, and any other IPv6 address as its /64 prefix
 * (`2001:db8:1:2::/64`). Anything else is returned unchanged.
 */
export function addressKey(address: string): string {
  const groups = ipv6Groups(address)
  if (!groups) return address
  const isMapped = groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff
  if (isMapped) {
    const [high = 0, low = 0] = groups.slice(6)
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
  }
  const prefix = groups.slice(0, IPV6_BUCKET_PREFIX / 16).map(group => group.toString(16))
  return `${prefix.join(':')}::/${IPV6_BUCKET_PREFIX}`
}

/** The X-Forwarded-For entries of a request, left to right. */
function forwardedEntries(req: Pick<Request, 'headers'>): string[] {
  const header = req.headers['x-forwarded-for']
  const joined = Array.isArray(header) ? header.join(',') : (header ?? '')
  return joined ? joined.split(',').map(entry => entry.trim()) : []
}

/** The X-Forwarded-For entry Google appended (see TRUSTED_PROXY_HOPS), or ''. */
function appendedEntry(entries: string[], trustedHops: number): string {
  return entries.length >= trustedHops ? (entries[entries.length - trustedHops] ?? '') : ''
}

/**
 * The client address key for coarse abuse limits: the X-Forwarded-For entry Google
 * appended, never one the client could have sent, as an addressKey. Without the header
 * (local runs and tests), the socket's peer address.
 */
export function clientAddress(
  req: Pick<Request, 'headers' | 'socket'>,
  trustedHops = TRUSTED_PROXY_HOPS,
): string {
  const address = appendedEntry(forwardedEntries(req), trustedHops) || req.socket?.remoteAddress
  return address ? addressKey(address) : 'unknown'
}

// ---- Proxy hop self-check ---------------------------------------------------------

/** IPv4 ranges no real client connects from through Google's front end. */
const NOT_A_CLIENT_V4: readonly [string, number][] = [
  // Google's front ends and load balancer proxies (also the health check sources).
  ['35.191.0.0', 16],
  ['130.211.0.0', 22],
  // Private, shared, loopback and link-local addresses.
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
]

function ipv4Number(address: string): number | null {
  if (isIP(address) !== 4) return null
  return address.split('.').reduce((total, part) => total * 256 + Number(part), 0)
}

/**
 * Whether an address is one a real client could not have connected from: Google's
 * front-end and proxy ranges, private, loopback or link-local space. When the key a
 * limiter uses is mostly such an address, TRUSTED_PROXY_HOPS is too small.
 */
export function isProxyOrPrivateAddress(address: string): boolean {
  const v4 = ipv4Number(address)
  if (v4 !== null) {
    return NOT_A_CLIENT_V4.some(([base, bits]) => {
      const start = ipv4Number(base) ?? 0
      const size = 2 ** (32 - bits)
      return v4 >= start && v4 < start + size
    })
  }
  const groups = ipv6Groups(address)
  if (!groups) return false
  const [first = 0, second = 0, third = 0] = groups
  if (groups.every((group, index) => group === (index === 7 ? 1 : 0))) return true // ::1
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7, unique local
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10, link-local
  // 2600:2d00:1::/48 holds Google's IPv6 front-end and health check sources.
  return first === 0x2600 && second === 0x2d00 && third === 0x1
}

export interface ProxyHopMonitorOptions {
  /** Requests looked at before judging. */
  sampleSize?: number
  /** The share of sampled requests from non-client addresses that means misconfiguration. */
  alertShare?: number
  trustedHops?: number
}

/** What one sampled request looked like; never an address. */
type AddressKind = 'client' | 'not-a-client' | 'no-header'

/**
 * A once-per-instance self-check of TRUSTED_PROXY_HOPS. It looks at the first requests
 * an instance serves that carry X-Forwarded-For, and when most of them would be keyed
 * on a Google proxy or private address, logs the ERROR `client address is a proxy
 * address: check TRUSTED_PROXY_HOPS`, which the error-log alert sends to the owner,
 * instead of every person sharing one limiter budget. It logs one INFO line with the
 * first request's shape (entry count and address kind, never an address), which
 * infra/check-client-address.sh reads after a deploy.
 */
export class ProxyHopMonitor {
  private readonly sampleSize: number
  private readonly alertShare: number
  private readonly trustedHops: number
  private sampled = 0
  private notClient = 0
  private readonly entryCounts = new Map<number, number>()
  private done = false

  constructor(
    private readonly name: string,
    {
      sampleSize = 50,
      alertShare = 0.5,
      trustedHops = TRUSTED_PROXY_HOPS,
    }: ProxyHopMonitorOptions = {},
  ) {
    this.sampleSize = sampleSize
    this.alertShare = alertShare
    this.trustedHops = trustedHops
  }

  observe(req: Pick<Request, 'headers'>): void {
    if (this.done) return
    const entries = forwardedEntries(req)
    if (entries.length === 0) return // local runs and tests
    const appended = appendedEntry(entries, this.trustedHops)
    const kind: AddressKind = !appended
      ? 'no-header'
      : isProxyOrPrivateAddress(appended)
        ? 'not-a-client'
        : 'client'
    if (this.sampled === 0) {
      logger.info('client address check', {
        function: this.name,
        forwardedEntries: entries.length,
        trustedHops: this.trustedHops,
        kind,
      })
    }
    this.sampled += 1
    if (kind !== 'client') this.notClient += 1
    this.entryCounts.set(entries.length, (this.entryCounts.get(entries.length) ?? 0) + 1)
    if (this.sampled < this.sampleSize) return
    this.done = true
    if (this.notClient / this.sampled >= this.alertShare) {
      logger.error('client address is a proxy address: check TRUSTED_PROXY_HOPS', {
        function: this.name,
        sampled: this.sampled,
        notClient: this.notClient,
        trustedHops: this.trustedHops,
        forwardedEntryCounts: Object.fromEntries(this.entryCounts),
      })
    }
  }
}
