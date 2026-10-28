import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dropOrphanSourceMaps, orphanSourceMaps } from './orphan-source-maps.mts'

describe('orphan source maps', () => {
  it('removes maps without their script and keeps the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maps-'))
    const chunks = join(dir, '_next', 'static', 'chunks')
    mkdirSync(chunks, { recursive: true })
    writeFileSync(join(chunks, 'a.js'), '')
    writeFileSync(join(chunks, 'a.js.map'), '{}')
    writeFileSync(join(chunks, 'b.js.map'), '{"sections":[]}')
    expect(orphanSourceMaps(dir)).toEqual([join(chunks, 'b.js.map')])
    expect(dropOrphanSourceMaps(dir)).toEqual([join(chunks, 'b.js.map')])
    expect(existsSync(join(chunks, 'b.js.map'))).toBe(false)
    expect(existsSync(join(chunks, 'a.js.map'))).toBe(true)
    expect(orphanSourceMaps(join(dir, 'missing'))).toEqual([])
  })
})
