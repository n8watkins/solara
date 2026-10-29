// Playwright global teardown for the UI harness: merges the per-screen axe JSON
// files into test-results/ui-harness/axe-summary.{json,md}. Report-only.
// CI runs the harness in shards and merges every shard's reports with merge-axe.mts.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface ScreenReport {
  screen: string
  project: string
  blockedRequests: string[]
  pageErrors: string[]
  violations: { id: string; impact: string | null; help: string; nodes: unknown[] }[]
}

const OUTPUT_DIR = join('test-results', 'ui-harness')
const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor']

export default function axeSummary() {
  const axeDir = join(OUTPUT_DIR, 'axe')
  if (!existsSync(axeDir)) return
  const reports: ScreenReport[] = readdirSync(axeDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => JSON.parse(readFileSync(join(axeDir, f), 'utf8')))

  // Rule -> impact, help and node counts per "screen--project".
  const rules = new Map<string, { impact: string; help: string; counts: Record<string, number> }>()
  for (const r of reports) {
    for (const v of r.violations) {
      const rule = rules.get(v.id) ?? { impact: v.impact ?? 'unknown', help: v.help, counts: {} }
      rule.counts[`${r.screen}--${r.project}`] = v.nodes.length
      rules.set(v.id, rule)
    }
  }
  const sorted = [...rules.entries()].sort(
    ([a, ra], [b, rb]) =>
      IMPACT_ORDER.indexOf(ra.impact) - IMPACT_ORDER.indexOf(rb.impact) || a.localeCompare(b),
  )

  const columns = reports.map(r => `${r.screen}--${r.project}`)
  const totals = Object.fromEntries(
    reports.map(r => [
      `${r.screen}--${r.project}`,
      r.violations.reduce((n, v) => n + v.nodes.length, 0),
    ]),
  )

  writeFileSync(
    join(OUTPUT_DIR, 'axe-summary.json'),
    JSON.stringify(
      {
        screens: columns,
        totals,
        rules: Object.fromEntries(sorted),
        blockedRequests: [...new Set(reports.flatMap(r => r.blockedRequests))].sort(),
        pageErrors: reports
          .filter(r => r.pageErrors.length)
          .map(r => ({ screen: `${r.screen}--${r.project}`, errors: r.pageErrors })),
      },
      null,
      2,
    ) + '\n',
  )

  const lines = [
    '# UI harness axe report',
    '',
    'Report-only: violations do not fail `npm run test:harness`.',
    'Cells are the number of failing nodes per rule and screen.',
    '',
    `| Rule | Impact | ${columns.join(' | ')} |`,
    `| --- | --- | ${columns.map(() => '---:').join(' | ')} |`,
    ...sorted.map(
      ([id, rule]) =>
        `| \`${id}\` ${rule.help} | ${rule.impact} | ${columns.map(c => rule.counts[c] ?? 0).join(' | ')} |`,
    ),
    `| **Total nodes** | | ${columns.map(c => totals[c]).join(' | ')} |`,
    '',
  ]
  writeFileSync(join(OUTPUT_DIR, 'axe-summary.md'), lines.join('\n'))
  console.log(
    `UI harness: ${reports.length} screens scanned, ${rules.size} axe rules with violations. See ${join(OUTPUT_DIR, 'axe-summary.md')}`,
  )
}
