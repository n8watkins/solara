#!/usr/bin/env node
// One-time migration from client-minted `users.calendarFeedToken` to server-minted feed
// tokens indexed in `calendarFeeds/{sha256}`. See docs/DEPLOYMENT.md ("Calendar feed token
// migration") for when to run it. Safe to run more than once.
//
// Usage (Application Default Credentials with Firestore access), from functions/:
//   npm run migrate:feed-tokens -- --project <id> [--dry-run]

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'

import { loggableError } from '../shared/errors'
import { migrateLegacyFeedTokens } from './tokens'

function parseArgs(argv: string[]): { projectId: string; dryRun: boolean } {
  const projectIndex = argv.indexOf('--project')
  const projectId = projectIndex >= 0 ? argv[projectIndex + 1] : undefined
  if (!projectId || projectId.startsWith('--')) {
    throw new Error('Usage: migrate-legacy-tokens.js --project <id> [--dry-run]')
  }
  return { projectId, dryRun: argv.includes('--dry-run') }
}

async function main(): Promise<void> {
  const { projectId, dryRun } = parseArgs(process.argv.slice(2))
  const db = getFirestore(initializeApp({ projectId }))
  logger.info('Migrating calendar feed tokens', { projectId, dryRun })
  const report = await migrateLegacyFeedTokens({
    db,
    dryRun,
    log: (uid, outcome, shared) => logger.info('Feed token migrated', { uid, outcome, shared }),
  })
  logger.info('Calendar feed token migration complete', { projectId, dryRun, report })
}

main().catch((error: unknown) => {
  logger.error('Calendar feed token migration failed', { error: loggableError(error) })
  process.exitCode = 1
})
