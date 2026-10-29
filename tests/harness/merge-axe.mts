// Merges the axe reports of every UI harness shard into one summary, the way the
// harness's global teardown (axe-summary.ts) does for a single run. CI downloads each
// shard's test-results/ui-harness/ into one folder and runs
// `node tests/harness/merge-axe.mts`.
import { existsSync } from 'node:fs'
import axeSummary from './axe-summary.ts'

if (!existsSync('test-results/ui-harness/axe')) {
  console.error(
    'No axe reports in test-results/ui-harness/axe: did every shard upload its results?',
  )
  process.exit(1)
}
axeSummary()
