import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ICS_IMPORT_LIMITS } from '@solara/core/event-import'
import { sharedId } from './app-routes'
import {
  SHARE_BODY_MAX_BYTES,
  SHARE_CACHE,
  SHARE_FILE_FIELD,
  SHARE_FILE_MAX_BYTES,
  SHARE_KEEP_MS,
  SHARE_META_HEADER,
  SHARE_STASH_PATH,
  SHARE_TARGET_PATH,
  crossSiteReferrer,
  decodeShareMeta,
  displayFileName,
  encodeShareMeta,
  isCalendarFile,
  isSharePost,
  newShareId,
  readCapped,
  readStash,
  receiveShare,
  sharedAppUrl,
  sharedLink,
  stashFromForm,
  type ShareMeta,
  type StashCaches,
} from './share-target'
import { staleCaches } from './sw-shell.mts'
import { fakeCaches } from '../tests/fake-caches'

const ORIGIN = 'https://solara-uv.web.app'
const NOW = Date.UTC(2026, 5, 15, 17, 30)
const ID = '0123456789abcdef'
const ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'

function form(entries: Record<string, string | File | File[]>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(name, item)
  }
  return data
}

/**
 * A share sheet POST. Form data is encoded up front, as a browser sends it (Node's own
 * FormData body stream fails when a reader cancels it part way).
 */
async function shareRequest(
  body: FormData | string,
  init: { referrer?: string; headers?: Record<string, string> } = {},
): Promise<Request> {
  let headers = init.headers
  let bytes: string | ArrayBuffer = body as string
  if (body instanceof FormData) {
    const encoded = new Response(body)
    headers = { 'content-type': encoded.headers.get('content-type')!, ...headers }
    bytes = await encoded.arrayBuffer()
  }
  return new Request(`${ORIGIN}${SHARE_TARGET_PATH}`, {
    method: 'POST',
    body: bytes,
    headers,
    referrer: init.referrer ?? '',
  })
}

describe('the manifest', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
    scope: string
    share_target: {
      action: string
      method: string
      enctype: string
      params: { url: string; text: string; files: { name: string; accept: string[] }[] }
    }
  }

  it('posts shared calendar files and links to the address the worker takes', () => {
    const target = manifest.share_target
    expect(target.action).toBe(SHARE_TARGET_PATH)
    expect(target.action.startsWith(manifest.scope)).toBe(true)
    expect(target.method).toBe('POST')
    expect(target.enctype).toBe('multipart/form-data')
    expect(target.params.url).toBe('url')
    expect(target.params.text).toBe('text')
    expect(target.params.files).toEqual([
      {
        name: SHARE_FILE_FIELD,
        accept: ['text/calendar', 'application/ics', 'text/x-vcalendar', '.ics'],
      },
    ])
  })

  it('has a static page at the share address for a share that reaches Hosting', () => {
    expect(readFileSync('app/app/share-target/page.tsx', 'utf8')).toContain('Share it again')
  })
})

describe('limits', () => {
  it('keeps files up to the import’s own size cap, and reads little more than that', () => {
    expect(SHARE_FILE_MAX_BYTES).toBe(ICS_IMPORT_LIMITS.maxBytes)
    expect(SHARE_BODY_MAX_BYTES - SHARE_FILE_MAX_BYTES).toBeLessThanOrEqual(64 * 1024)
  })

  it('is kept for 30 minutes, in a cache new app versions leave alone', () => {
    expect(SHARE_KEEP_MS).toBe(30 * 60_000)
    expect(staleCaches([SHARE_CACHE, 'solara-shell-old', 'solara-static-old'], 'new')).toEqual([
      'solara-shell-old',
      'solara-static-old',
    ])
  })
})

describe('isSharePost', () => {
  const post = { method: 'POST', mode: 'navigate', url: `${ORIGIN}${SHARE_TARGET_PATH}` }

  it('takes only a POST navigation to the share address on this origin', () => {
    expect(isSharePost(post, ORIGIN)).toBe(true)
    expect(isSharePost({ ...post, method: 'GET' }, ORIGIN)).toBe(false)
    expect(isSharePost({ ...post, mode: 'cors' }, ORIGIN)).toBe(false)
    expect(isSharePost({ ...post, url: `${ORIGIN}/app/` }, ORIGIN)).toBe(false)
    expect(isSharePost({ ...post, url: `${ORIGIN}/app/share-target` }, ORIGIN)).toBe(false)
    expect(isSharePost({ ...post, url: `https://other.example${SHARE_TARGET_PATH}` }, ORIGIN)).toBe(
      false,
    )
  })
})

describe('crossSiteReferrer', () => {
  it('allows the share sheet (no referrer), Android apps and Solara itself', () => {
    expect(crossSiteReferrer('', ORIGIN)).toBe(false)
    expect(crossSiteReferrer('android-app://com.google.android.gm/', ORIGIN)).toBe(false)
    expect(crossSiteReferrer(`${ORIGIN}/app/`, ORIGIN)).toBe(false)
  })

  it('refuses another website', () => {
    expect(crossSiteReferrer('https://other.example/page', ORIGIN)).toBe(true)
    expect(crossSiteReferrer('http://solara-uv.web.app/', ORIGIN)).toBe(true)
    expect(crossSiteReferrer('not a url', ORIGIN)).toBe(true)
  })
})

describe('isCalendarFile', () => {
  it('accepts calendar types, and .ics names with no or a generic type', () => {
    expect(isCalendarFile({ name: 'invite.ics', type: 'text/calendar' })).toBe(true)
    expect(isCalendarFile({ name: 'x', type: 'text/calendar; charset=utf-8' })).toBe(true)
    expect(isCalendarFile({ name: 'x', type: 'application/ics' })).toBe(true)
    expect(isCalendarFile({ name: 'x', type: 'TEXT/X-VCALENDAR' })).toBe(true)
    expect(isCalendarFile({ name: 'Invite.ICS', type: '' })).toBe(true)
    expect(isCalendarFile({ name: 'invite.ics', type: 'application/octet-stream' })).toBe(true)
  })

  it('refuses anything else, whatever its name', () => {
    expect(isCalendarFile({ name: 'invite.ics', type: 'text/html' })).toBe(false)
    expect(isCalendarFile({ name: 'invite.ics', type: 'image/svg+xml' })).toBe(false)
    expect(isCalendarFile({ name: 'photo.png', type: '' })).toBe(false)
    expect(isCalendarFile({ name: 'invite.ics.html', type: '' })).toBe(false)
  })
})

describe('displayFileName', () => {
  it('shows the name only, without control characters, at most 80 characters', () => {
    expect(displayFileName('invite.ics')).toBe('invite.ics')
    expect(displayFileName('/sdcard/Download/invite.ics')).toBe('invite.ics')
    expect(displayFileName('C:\\Users\\x\\invite.ics')).toBe('invite.ics')
    expect(displayFileName('in\u202evite\u0000.ics')).toBe('invite.ics')
    expect(displayFileName('   ')).toBe('the shared file')
    expect(displayFileName(`${'a'.repeat(100)}.ics`)).toHaveLength(78)
  })
})

describe('sharedLink', () => {
  it('takes the url field, else the first https or webcal link in the text', () => {
    expect(sharedLink({ url: 'https://club.example/cal.ics' })).toBe('https://club.example/cal.ics')
    expect(sharedLink({ text: 'Our races: webcal://club.example/races.ics.' })).toBe(
      'webcal://club.example/races.ics',
    )
    expect(sharedLink({ url: '', text: 'See (https://club.example/e/1)!' })).toBe(
      'https://club.example/e/1',
    )
  })

  it('ignores other schemes, credentials and overlong links', () => {
    expect(sharedLink({ url: 'http://club.example/cal.ics' })).toBeNull()
    expect(sharedLink({ url: 'javascript:alert(1)' })).toBeNull()
    expect(sharedLink({ url: 'https://user:pass@club.example/cal.ics' })).toBeNull()
    expect(sharedLink({ url: `https://club.example/${'a'.repeat(2100)}` })).toBeNull()
    expect(sharedLink({ text: 'no link here' })).toBeNull()
    expect(sharedLink({})).toBeNull()
  })
})

describe('share descriptions', () => {
  const file: ShareMeta = { v: 1, id: ID, at: NOW, kind: 'file', name: 'invite.ics' }

  it('round-trip as an ASCII header value', () => {
    const named: ShareMeta = { ...file, name: 'Fête du soleil 🌞.ics' }
    const value = encodeShareMeta(named)
    expect(value).toMatch(/^[\x21-\x7e]+$/)
    expect(decodeShareMeta(value, NOW)).toEqual(named)
    const link: ShareMeta = { v: 1, id: ID, at: NOW, kind: 'link', link: 'https://a.example/c' }
    expect(decodeShareMeta(encodeShareMeta(link), NOW)).toEqual(link)
  })

  it('expire after SHARE_KEEP_MS', () => {
    const value = encodeShareMeta(file)
    expect(decodeShareMeta(value, NOW + SHARE_KEEP_MS)).toEqual(file)
    expect(decodeShareMeta(value, NOW + SHARE_KEEP_MS + 1)).toBeNull()
  })

  it('refuse anything malformed or from another format', () => {
    expect(decodeShareMeta(null, NOW)).toBeNull()
    expect(decodeShareMeta('%E0%A4%A', NOW)).toBeNull()
    expect(decodeShareMeta(encodeURIComponent('[]'), NOW)).toBeNull()
    expect(decodeShareMeta(encodeShareMeta({ ...file, v: 2 } as never), NOW)).toBeNull()
    expect(decodeShareMeta(encodeShareMeta({ ...file, id: '../x' }), NOW)).toBeNull()
    expect(decodeShareMeta(encodeShareMeta({ ...file, kind: 'script' } as never), NOW)).toBeNull()
    const badLink = { v: 1, id: ID, at: NOW, kind: 'link', link: 'javascript:alert(1)' }
    expect(decodeShareMeta(encodeShareMeta(badLink as ShareMeta), NOW)).toBeNull()
  })
})

describe('ids', () => {
  it('are 16 random hex characters, and only those are accepted from the address', () => {
    const id = newShareId()
    expect(sharedId(id)).toBe(id)
    expect(newShareId()).not.toBe(id)
    expect(sharedId('0123456789ABCDEF')).toBeNull()
    expect(sharedId('0123')).toBeNull()
    expect(sharedId(null)).toBeNull()
    expect(sharedAppUrl(id)).toBe(`/app/?shared=${id}`)
  })
})

describe('readCapped', () => {
  it('reads a body up to the cap', async () => {
    const body = await readCapped(new Request(ORIGIN, { method: 'POST', body: 'abc' }), 3)
    expect(new TextDecoder().decode(body!)).toBe('abc')
  })

  it('refuses a body over the cap, streamed or declared, without keeping it', async () => {
    expect(await readCapped(new Request(ORIGIN, { method: 'POST', body: 'abcd' }), 3)).toBeNull()
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(1024))
      },
    })
    const streamed = new Request(ORIGIN, {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect(await readCapped(streamed, 4096)).toBeNull()
    expect(pulled).toBeLessThanOrEqual(6)
    const declared = new Request(ORIGIN, {
      method: 'POST',
      body: 'abc',
      headers: { 'content-length': '999999999' },
    })
    expect(await readCapped(declared, 3)).toBeNull()
  })
})

describe('stashFromForm', () => {
  const ics = (name = 'invite.ics', type = 'text/calendar', body = ICS) =>
    new File([body], name, { type })

  it('keeps a calendar file as plain bytes, with its name', async () => {
    const stash = stashFromForm(form({ calendar: ics() }), ID, NOW)
    expect(stash.meta).toEqual({ v: 1, id: ID, at: NOW, kind: 'file', name: 'invite.ics' })
    expect(stash.file!.type).toBe('application/octet-stream')
    expect(await stash.file!.text()).toBe(ICS)
  })

  it('prefers a calendar file among several, and a file over a link', () => {
    const stash = stashFromForm(
      form({
        calendar: [new File(['x'], 'a.png', { type: 'image/png' }), ics('b.ics')],
        url: 'https://club.example/c.ics',
      }),
      ID,
      NOW,
    )
    expect(stash.meta).toMatchObject({ kind: 'file', name: 'b.ics' })
  })

  it('refuses a file of another type, or one over the cap, keeping nothing of it', () => {
    const html = stashFromForm(form({ calendar: ics('x.ics', 'text/html', '<b>') }), ID, NOW)
    expect(html).toEqual({
      meta: { v: 1, id: ID, at: NOW, kind: 'refused', reason: 'not-calendar' },
      file: null,
    })
    const big = new File([new Uint8Array(SHARE_FILE_MAX_BYTES + 1)], 'big.ics', {
      type: 'text/calendar',
    })
    expect(stashFromForm(form({ calendar: big }), ID, NOW)).toEqual({
      meta: { v: 1, id: ID, at: NOW, kind: 'refused', reason: 'too-large' },
      file: null,
    })
  })

  it('keeps a link from the url or text field, or says nothing came', () => {
    expect(stashFromForm(form({ text: 'Races https://club.example/r.ics' }), ID, NOW).meta).toEqual(
      { v: 1, id: ID, at: NOW, kind: 'link', link: 'https://club.example/r.ics' },
    )
    // An empty file input comes through as an empty file.
    const empty = form({ calendar: new File([], ''), title: 'Hi' })
    expect(stashFromForm(empty, ID, NOW).meta).toMatchObject({
      kind: 'refused',
      reason: 'nothing',
    })
  })
})

describe('receiveShare', () => {
  it('keeps the file and redirects to the app with its id (303, so it becomes a GET)', async () => {
    const storage = fakeCaches()
    const response = await receiveShare(
      await shareRequest(
        form({ calendar: new File([ICS], 'invite.ics', { type: 'text/calendar' }) }),
      ),
      ORIGIN,
      storage,
      NOW,
      ID,
    )
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/app/?shared=${ID}`)
    const kept = await readStash(storage, NOW + 1000)
    expect(kept?.meta).toEqual({ v: 1, id: ID, at: NOW, kind: 'file', name: 'invite.ics' })
    expect(await kept!.response.text()).toBe(ICS)
    expect(kept!.response.headers.get('content-type')).toBe('application/octet-stream')
  })

  it('replaces an earlier share', async () => {
    const storage = fakeCaches()
    await receiveShare(
      await shareRequest(form({ url: 'https://a.example/1.ics' })),
      ORIGIN,
      storage,
      NOW,
    )
    await receiveShare(
      await shareRequest(form({ url: 'https://a.example/2.ics' })),
      ORIGIN,
      storage,
      NOW,
      ID,
    )
    const kept = await readStash(storage, NOW)
    expect(kept?.meta).toMatchObject({ id: ID, link: 'https://a.example/2.ics' })
  })

  it('refuses a body over the cap before it is parsed', async () => {
    const storage = fakeCaches()
    const big = new File([new Uint8Array(SHARE_BODY_MAX_BYTES)], 'big.ics', {
      type: 'text/calendar',
    })
    await receiveShare(await shareRequest(form({ calendar: big })), ORIGIN, storage, NOW, ID)
    const kept = await readStash(storage, NOW)
    expect(kept?.meta).toMatchObject({ kind: 'refused', reason: 'too-large' })
    expect((await kept!.response.blob()).size).toBe(0)
  })

  it('refuses bodies that are not multipart form data', async () => {
    const storage = fakeCaches()
    await receiveShare(
      await shareRequest('url=https://a.example/c.ics', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
      ORIGIN,
      storage,
      NOW,
      ID,
    )
    expect((await readStash(storage, NOW))?.meta).toMatchObject({ reason: 'nothing' })
  })

  it('keeps nothing from another website and opens the app', async () => {
    const storage = fakeCaches()
    const response = await receiveShare(
      await shareRequest(
        form({ calendar: new File([ICS], 'invite.ics', { type: 'text/calendar' }) }),
        {
          referrer: 'https://other.example/',
        },
      ),
      ORIGIN,
      storage,
      NOW,
      ID,
    )
    expect(response.headers.get('location')).toBe(`${ORIGIN}/app/`)
    expect(storage.names()).toEqual([])
  })

  it('still opens the app when storage fails', async () => {
    const storage: StashCaches = {
      has: () => Promise.resolve(false),
      open: () => Promise.reject(new Error('quota')),
      delete: () => Promise.resolve(false),
    }
    const response = await receiveShare(
      await shareRequest(form({ url: 'https://a.example/c.ics' })),
      ORIGIN,
      storage,
      NOW,
      ID,
    )
    expect(response.headers.get('location')).toBe(`${ORIGIN}/app/?shared=${ID}`)
  })
})

describe('readStash', () => {
  it('removes a share that expired or is malformed', async () => {
    const storage = fakeCaches()
    await receiveShare(
      await shareRequest(form({ url: 'https://a.example/c.ics' })),
      ORIGIN,
      storage,
      NOW,
    )
    expect(await readStash(storage, NOW + SHARE_KEEP_MS + 1)).toBeNull()
    expect(storage.names()).toEqual([])

    const cache = await storage.open(SHARE_CACHE)
    await cache.put(
      SHARE_STASH_PATH,
      new Response('', { headers: { [SHARE_META_HEADER]: 'garbage' } }),
    )
    expect(await readStash(storage, NOW)).toBeNull()
    expect(storage.names()).toEqual([])
  })
})
