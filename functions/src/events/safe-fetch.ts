// Fetching a calendar link someone else chose, without letting it reach anything it
// should not (server-side request forgery) or cost more than a bounded amount.
//
// - Only https on port 443, without a user name or password (normalizeSubscriptionUrl).
// - Every host name is resolved here, and the connection is made to the address that was
//   checked (a custom `lookup`), so a DNS answer cannot change between the check and the
//   connection (DNS rebinding). Every address the name resolves to must be public: no
//   loopback, private, carrier-grade NAT, link-local (which includes the metadata server
//   at 169.254.169.254), multicast, reserved or documentation ranges, and for IPv6 only
//   global unicast (2000::/3) outside its special-purpose blocks, so IPv4-mapped, NAT64
//   and 6to4 addresses cannot smuggle a private IPv4 address in.
// - Redirects are followed by hand, at most EVENT_SUBSCRIPTION_LIMITS.maxRedirects, each
//   checked like the first link.
// - One deadline (timeoutMs) covers the whole fetch, redirects included; the body is read
//   up to maxBytes (after decompression), and anything larger is abandoned.
// - The answer must be a calendar: an allowlisted content type and a body that starts
//   with BEGIN:VCALENDAR.
// - No cookies, credentials or Solara headers are sent; the link is never logged.

import { lookup as dnsLookup } from 'node:dns'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { BlockList, isIP } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { Transform } from 'node:stream'

import {
  EVENT_SUBSCRIPTION_LIMITS,
  type SubscriptionError,
  normalizeSubscriptionUrl,
} from '#core/event-import'

const BLOCKED_V4: readonly [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, the metadata server
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
]

/** Special-purpose blocks inside IPv6 global unicast (2000::/3). */
const BLOCKED_V6: readonly [string, number][] = [
  ['2001::', 23], // IETF protocol assignments, Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds an IPv4 address)
  ['3ffe::', 16], // the retired 6bone
  ['3fff::', 20], // documentation
]

const blocked = new BlockList()
for (const [network, prefix] of BLOCKED_V4) blocked.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of BLOCKED_V6) blocked.addSubnet(network, prefix, 'ipv6')
const globalUnicast = new BlockList()
globalUnicast.addSubnet('2000::', 3, 'ipv6')

/** Whether an IP address is a public internet address a link may lead to. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  if (family === 6) {
    // Zone ids (fe80::1%eth0) are link-local anyway; anything outside 2000::/3 (loopback,
    // unspecified, IPv4-mapped, NAT64, unique local, link-local, multicast) is refused.
    if (address.includes('%')) return false
    return globalUnicast.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
  }
  return false
}

/** Host names that never lead to the public internet, whatever DNS says. */
function blockedHostName(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, '')
  return (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name.endsWith('.local') ||
    name.endsWith('.internal') ||
    name.endsWith('.home.arpa') ||
    name === 'metadata' ||
    name === 'metadata.google.internal'
  )
}

/** An answer from a DNS lookup. */
export interface ResolvedAddress {
  address: string
  family: number
}

/** Resolves a host name to every address it has. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>

export const systemResolver: Resolver = hostname =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) =>
      error ? reject(error) : resolve(addresses),
    )
  })

export class BlockedAddressError extends Error {
  constructor() {
    super('The link resolves to an address that is not on the public internet')
    this.name = 'BlockedAddressError'
  }
}

/**
 * The addresses to connect to for a host: all of them public, or a BlockedAddressError.
 * One private answer blocks the host, so a name that mixes public and private answers
 * cannot be used to reach the private one.
 */
export async function publicAddresses(
  hostname: string,
  resolve: Resolver,
): Promise<ResolvedAddress[]> {
  const bare = hostname.replace(/^\[|\]$/g, '')
  if (isIP(bare)) {
    if (!isPublicAddress(bare)) throw new BlockedAddressError()
    return [{ address: bare, family: isIP(bare) }]
  }
  if (blockedHostName(bare)) throw new BlockedAddressError()
  const addresses = await resolve(bare)
  if (addresses.length === 0 || addresses.some(entry => !isPublicAddress(entry.address))) {
    throw new BlockedAddressError()
  }
  return addresses
}

/** What a transport needs to make one GET request. */
export interface TransportRequest {
  url: URL
  /** Public addresses already checked for `url.hostname`; the connection must use one. */
  addresses: ResolvedAddress[]
  headers: Record<string, string>
  signal: AbortSignal
}

/** A response: status, headers and the raw (possibly compressed) body. */
export interface TransportResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: AsyncIterable<Buffer> & { destroy?: () => void }
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>

/**
 * Node's https client, connecting only to the checked addresses: the `lookup` hands the
 * socket the address resolved and checked above instead of asking DNS again. TLS still
 * verifies the certificate against the host name.
 */
export const httpsTransport: Transport = ({ url, addresses, headers, signal }) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: 'GET',
        headers,
        signal,
        agent: false,
        lookup: (_hostname, options, callback) => {
          const all = (options as { all?: boolean }).all
          if (all) {
            ;(callback as (error: null, addresses: ResolvedAddress[]) => void)(null, addresses)
          } else {
            const first = addresses[0] as ResolvedAddress
            ;(callback as (error: null, address: string, family: number) => void)(
              null,
              first.address,
              first.family,
            )
          }
        },
      },
      (response: IncomingMessage) => {
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response })
      },
    )
    request.on('error', reject)
    request.end()
  })

export type FetchCalendarResult =
  | { ok: true; notModified: true }
  | {
      ok: true
      notModified: false
      text: string
      etag: string | null
      lastModified: string | null
    }
  | { ok: false; error: SubscriptionError }

export interface FetchCalendarOptions {
  /** Validators from the last successful fetch of this link, for a conditional request. */
  etag?: string | null
  lastModified?: string | null
  resolve?: Resolver
  transport?: Transport
  timeoutMs?: number
  maxBytes?: number
}

/** Content types a calendar is served with; a missing type is accepted too. */
const CALENDAR_TYPES = new Set([
  'text/calendar',
  'application/ics',
  'text/x-calendar',
  'application/x-ical',
  'text/plain',
  'application/octet-stream',
  'binary/octet-stream',
  'application/download',
  'application/force-download',
])

const REDIRECTS = new Set([301, 302, 303, 307, 308])

export const FETCH_HEADERS = Object.freeze({
  'User-Agent': 'SolaraCalendarLink/1.0 (+https://solara-uv.web.app/privacy/)',
  Accept: 'text/calendar, text/plain;q=0.5, */*;q=0.1',
  'Accept-Encoding': 'gzip, deflate, br',
})

function header(headers: TransportResponse['headers'], name: string): string | null {
  const value = headers[name]
  if (Array.isArray(value)) return value[0] ?? null
  return typeof value === 'string' ? value : null
}

class BodyTooLarge extends Error {}

function decoder(encoding: string | null): Transform | null | 'unsupported' {
  const name = (encoding ?? '').trim().toLowerCase()
  if (!name || name === 'identity') return null
  if (name === 'gzip' || name === 'x-gzip') return createGunzip()
  if (name === 'deflate') return createInflate()
  if (name === 'br') return createBrotliDecompress()
  return 'unsupported'
}

/** Reads a body up to `maxBytes` after decoding; throws BodyTooLarge past it. */
async function readBody(
  response: TransportResponse,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const encoding = decoder(header(response.headers, 'content-encoding'))
  if (encoding === 'unsupported') throw new TypeError('unsupported content encoding')
  const chunks: Buffer[] = []
  let size = 0
  const take = (chunk: Buffer) => {
    size += chunk.length
    if (size > maxBytes) throw new BodyTooLarge()
    chunks.push(chunk)
  }
  // Compressed bodies are limited on the wire too, so a slow trickle of a small
  // compressed file cannot run past the deadline unnoticed (the signal aborts it).
  let wire = 0
  try {
    if (!encoding) {
      for await (const chunk of response.body) {
        if (signal.aborted) throw signal.reason
        take(chunk)
      }
    } else {
      const done = new Promise<void>((resolve, reject) => {
        encoding.on('data', (chunk: Buffer) => {
          try {
            take(chunk)
          } catch (error) {
            encoding.destroy()
            reject(error)
          }
        })
        encoding.on('end', resolve)
        encoding.on('error', reject)
      })
      for await (const chunk of response.body) {
        if (signal.aborted) throw signal.reason
        wire += chunk.length
        if (wire > maxBytes) throw new BodyTooLarge()
        if (!encoding.write(chunk)) await new Promise(resolve => encoding.once('drain', resolve))
      }
      encoding.end()
      await done
    }
  } finally {
    response.body.destroy?.()
  }
  return Buffer.concat(chunks, size)
}

/** Whether text read from a link is an iCalendar file (it starts with BEGIN:VCALENDAR). */
export function looksLikeCalendar(text: string): boolean {
  return /^\s*BEGIN:VCALENDAR\b/i.test(text.replace(/^﻿/, ''))
}

/**
 * Fetches a calendar link within the limits above. Never throws: every failure is one of
 * the stored error codes.
 */
export async function fetchCalendar(
  link: string,
  {
    etag,
    lastModified,
    resolve = systemResolver,
    transport = httpsTransport,
    timeoutMs = EVENT_SUBSCRIPTION_LIMITS.timeoutMs,
    maxBytes = EVENT_SUBSCRIPTION_LIMITS.maxBytes,
  }: FetchCalendarOptions = {},
): Promise<FetchCalendarResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  const timedOut = () => controller.signal.aborted
  try {
    let current = link
    for (let redirects = 0; ; redirects += 1) {
      const normalized = normalizeSubscriptionUrl(current)
      if (!normalized.ok) {
        // A redirect to plain http, another port or a URL with credentials is refused.
        return { ok: false, error: normalized.error }
      }
      const url = new URL(normalized.url)
      let addresses: ResolvedAddress[]
      try {
        addresses = await publicAddresses(url.hostname, resolve)
      } catch (error) {
        if (error instanceof BlockedAddressError) return { ok: false, error: 'blocked-address' }
        return { ok: false, error: timedOut() ? 'timeout' : 'unreachable' }
      }
      if (timedOut()) return { ok: false, error: 'timeout' }
      const headers: Record<string, string> = { ...FETCH_HEADERS }
      // Validators belong to the link as stored, so only the first request sends them.
      if (redirects === 0 && etag) headers['If-None-Match'] = etag
      if (redirects === 0 && lastModified) headers['If-Modified-Since'] = lastModified
      let response: TransportResponse
      try {
        response = await transport({ url, addresses, headers, signal: controller.signal })
      } catch {
        return { ok: false, error: timedOut() ? 'timeout' : 'unreachable' }
      }

      if (REDIRECTS.has(response.status)) {
        response.body.destroy?.()
        const location = header(response.headers, 'location')
        if (!location) return { ok: false, error: 'http-status' }
        if (redirects >= EVENT_SUBSCRIPTION_LIMITS.maxRedirects) {
          return { ok: false, error: 'too-many-redirects' }
        }
        try {
          current = new URL(location, url).href
        } catch {
          return { ok: false, error: 'invalid-url' }
        }
        continue
      }
      if (response.status === 304 && (etag || lastModified)) {
        response.body.destroy?.()
        return { ok: true, notModified: true }
      }
      if (response.status < 200 || response.status >= 300) {
        response.body.destroy?.()
        return { ok: false, error: 'http-status' }
      }

      const type = (header(response.headers, 'content-type') ?? '')
        .split(';')[0]
        ?.trim()
        .toLowerCase()
      if (type && !CALENDAR_TYPES.has(type)) {
        response.body.destroy?.()
        return { ok: false, error: 'not-calendar' }
      }
      const declared = Number(header(response.headers, 'content-length'))
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.body.destroy?.()
        return { ok: false, error: 'too-large' }
      }
      let body: Buffer
      try {
        body = await readBody(response, maxBytes, controller.signal)
      } catch (error) {
        if (error instanceof BodyTooLarge) return { ok: false, error: 'too-large' }
        if (timedOut()) return { ok: false, error: 'timeout' }
        return { ok: false, error: error instanceof TypeError ? 'not-calendar' : 'unreachable' }
      }
      const text = new TextDecoder('utf-8').decode(body)
      if (!looksLikeCalendar(text)) return { ok: false, error: 'not-calendar' }
      return {
        ok: true,
        notModified: false,
        text,
        etag: header(response.headers, 'etag')?.slice(0, 200) ?? null,
        lastModified: header(response.headers, 'last-modified')?.slice(0, 100) ?? null,
      }
    }
  } finally {
    clearTimeout(timer)
  }
}
