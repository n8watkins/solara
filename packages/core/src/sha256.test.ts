import { createHash, webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { feedEventKey, feedSeriesId, importedEventKey, importedSeriesId } from './events'
import { sha256, sha256Hex, utf8Bytes } from './sha256'

const nodeHex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

/** The digest the keys used before core had its own hasher (Web Crypto). */
async function subtleHex(text: string): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Buffer.from(digest).toString('hex')
}

// Fixtures: the FIPS 180-4 examples, the padding boundaries and text Solara hashes.
const FIXTURES = [
  '',
  'abc',
  'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
  'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
  'file\nuid-123\n',
  'feed\nfeed-abc\nuid-123\n20260615T170000Z',
  'Café ☀️ 日本 🏃‍♀️',
  'a lone \ud800 high and \udc00 low surrogate',
  ...[55, 56, 63, 64, 65, 119, 120, 127, 128, 1000].map(n => 'x'.repeat(n)),
]

describe('sha256', () => {
  it('matches the published test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(sha256Hex(FIXTURES[2]!)).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it.each(FIXTURES.map(text => [text.length, text]))(
    'equals Node and Web Crypto for a %i-character text',
    async (_, text) => {
      expect(sha256Hex(text)).toBe(nodeHex(text))
      expect(sha256Hex(text)).toBe(await subtleHex(text))
    },
  )

  it('equals Node for a million bytes', () => {
    const bytes = new Uint8Array(1_000_000).fill(0x61)
    expect(Buffer.from(sha256(bytes)).toString('hex')).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    )
  })

  it('equals Node for every length up to 300 bytes of varied content', () => {
    for (let n = 0; n <= 300; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + n * 7) & 0xff)
      expect(Buffer.from(sha256(bytes)).toString('hex')).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      )
    }
  })
})

describe('utf8Bytes', () => {
  it('encodes exactly as TextEncoder does', () => {
    const encoder = new TextEncoder()
    for (const text of [...FIXTURES, '\u007f\u0080߿ࠀ￿', '􏿿', '\ud83d']) {
      expect([...utf8Bytes(text)]).toEqual([...encoder.encode(text)])
    }
  })
})

describe('imported event keys', () => {
  // Keys are stored document ids, so the hasher must give the same keys as before.
  it('are unchanged from the Web Crypto keys', async () => {
    const before = async (text: string) => (await subtleHex(text)).slice(0, 32)
    expect(await importedSeriesId('file', 'uid-1')).toBe(await before('file\nuid-1'))
    expect(await importedEventKey('google', 'uid-1', null)).toBe(await before('google\nuid-1\n'))
    expect(await importedEventKey('file', 'uid-1', '20260615T170000Z')).toBe(
      await before('file\nuid-1\n20260615T170000Z'),
    )
    expect(await feedSeriesId('feed-1', 'uid-1')).toBe(await before('feed\nfeed-1\nuid-1'))
    expect(await feedEventKey('feed-1', 'uid-1', 'r')).toBe(await before('feed\nfeed-1\nuid-1\nr'))
  })
})
