import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dropOrphanSourceMaps, orphanSourceMaps } from './orphan-source-maps.mts'

function exportDir() {
  const dir = mkdtempSync(join(tmpdir(), 'maps-'))
  const chunks = join(dir, '_next', 'static', 'chunks')
  mkdirSync(chunks, { recursive: true })
  return { dir, chunks }
}

describe('orphan source maps', () => {
  it('removes maps without their script and keeps the rest', () => {
    const { dir, chunks } = exportDir()
    writeFileSync(join(chunks, 'a.js'), '')
    writeFileSync(join(chunks, 'a.js.map'), '{}')
    writeFileSync(join(chunks, 'b.js.map'), '{"sections":[]}')
    expect(orphanSourceMaps(dir)).toEqual([join(chunks, 'b.js.map')])
    expect(dropOrphanSourceMaps(dir)).toEqual([join(chunks, 'b.js.map')])
    expect(existsSync(join(chunks, 'b.js.map'))).toBe(false)
    expect(existsSync(join(chunks, 'a.js.map'))).toBe(true)
    expect(orphanSourceMaps(join(dir, 'missing'))).toEqual([])
  })

  it("keeps a map that a script names in its sourceMappingURL, as Turbopack's are", () => {
    // A build with browser source maps (Sentry): every chunk's map has another name.
    const { dir, chunks } = exportDir()
    writeFileSync(
      join(chunks, '22b7wjam7uezj.js'),
      'a()\n//# sourceMappingURL=0_-ppp310y_dg.js.map',
    )
    writeFileSync(join(chunks, '0_-ppp310y_dg.js.map'), '{}')
    writeFileSync(join(chunks, 'app.css'), 'a{}\n/*# sourceMappingURL=app.css.0x.map */')
    writeFileSync(join(chunks, 'app.css.0x.map'), '{}')
    // The Web Worker group's empty map, which no emitted script names.
    writeFileSync(join(chunks, '1worker.js.map'), '{"sections":[]}')
    // A comment that is not the last thing in the file names nothing.
    writeFileSync(join(chunks, 'c.js'), '//# sourceMappingURL=c-old.js.map\nb()')
    writeFileSync(join(chunks, 'c-old.js.map'), '{}')
    expect(orphanSourceMaps(dir).sort()).toEqual(
      [join(chunks, '1worker.js.map'), join(chunks, 'c-old.js.map')].sort(),
    )
  })
})
