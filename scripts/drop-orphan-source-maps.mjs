#!/usr/bin/env node
// Removes source maps whose script is not in the export (see lib/orphan-source-maps.mts).
// Usage: node scripts/drop-orphan-source-maps.mjs [exportDir]   (default: out)
import { relative } from 'node:path'
import { dropOrphanSourceMaps } from '../lib/orphan-source-maps.mts'

const dir = process.argv[2] ?? 'out'
const dropped = dropOrphanSourceMaps(dir)
if (dropped.length) {
  console.log(`drop-orphan-source-maps: removed ${dropped.map(f => relative(dir, f)).join(', ')}`)
}
