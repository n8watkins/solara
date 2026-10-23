#!/usr/bin/env node
// One-time migration from client-minted `users.calendarFeedToken` to server-minted feed
// tokens indexed in `calendarFeeds/{sha256}`. See docs/DEPLOYMENT.md ("Calendar feed token
// migration") for when to run it. Safe to run more than once.
//
// Usage (Application Default Credentials with Firestore access):
//   node scripts/migrate-calendar-feed-tokens.js --project <id> [--dry-run]

const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { migrateLegacyFeedTokens } = require('../lib/feed-tokens')

/** @param {string[]} argv */
function parseArgs(argv) {
  const projectIndex = argv.indexOf('--project')
  const projectId = projectIndex >= 0 ? argv[projectIndex + 1] : undefined
  if (!projectId || projectId.startsWith('--')) {
    throw new Error('Usage: migrate-calendar-feed-tokens.js --project <id> [--dry-run]')
  }
  return { projectId, dryRun: argv.includes('--dry-run') }
}

async function main() {
  const { projectId, dryRun } = parseArgs(process.argv.slice(2))
  const db = getFirestore(initializeApp({ projectId }))
  console.log(`${dryRun ? 'Dry run: ' : ''}migrating calendar feed tokens in ${projectId}`)
  const report = await migrateLegacyFeedTokens({ db, dryRun, log: line => console.log(line) })
  console.log(JSON.stringify(report))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
