#!/usr/bin/env node
// Answers an emailed data request by hand while the account Functions are not deployed
// (the free Spark stage; docs/RUNBOOK.md, "Free stage (Spark)"): a copy of everything
// Solara holds for one account, or its deletion. Once the Functions run, people use the
// Account data controls page instead, which also handles Stripe; this script refuses an
// account with billing records for that reason.
//
// It walks users/{uid} and every subcollection it finds (listCollections), so nothing the
// app or the Functions write there is missed (events, meta, scheduled, alertState,
// private, notificationDevices, billingResources), plus the per-account records outside
// it that functions/src/account/deletion.ts removes (calendarFeeds, eventSubscriptions,
// notificationTokenOwners, notificationRegistrationLimits), and the Firebase Auth user.
//
// The copy is the file the Account data page downloads (readAccountExport in
// functions/src/account/export.ts, built by @solara/core/account-export), plus the
// sign-in's email and name: never push tokens, billing ids or server bookkeeping
// (REVIEW9 SEC9 L4). Deletion needs `--confirmed-reply <date>`, the date the account's own
// address answered the owner's reply: an email's sender is easy to fake, so the request
// alone never deletes anything (docs/RUNBOOK.md, "An emailed export or deletion request").
//
// Usage, from the repository root after `npm ci --prefix functions` and
// `npm run build --prefix functions`, signed in as the project owner with
// `gcloud auth application-default login`:
//   node infra/account-request.mjs export <uid> > solara-<uid>.json   # read only
//   node infra/account-request.mjs delete <uid>                       # lists what it would delete
//   node infra/account-request.mjs delete <uid> --apply --confirmed-reply 2026-10-29
// PROJECT_ID defaults to uv-activity-planner. With FIRESTORE_EMULATOR_HOST and
// FIREBASE_AUTH_EMULATOR_HOST set, it works on the emulators instead.
import { createRequire } from 'node:module'

const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore } = require('firebase-admin/firestore')

const PROJECT_ID = process.env.PROJECT_ID || 'uv-activity-planner'
// Top-level records that belong to one account, found by their `uid` field.
const BY_UID = ['calendarFeeds', 'eventSubscriptions', 'notificationTokenOwners']
// Top-level records keyed by the uid.
const BY_ID = ['notificationRegistrationLimits']
/** How long ago the confirming reply may be: a request is answered within 30 days. */
const CONFIRMATION_MAX_DAYS = 30

function usage(message) {
  if (message) console.error(message)
  console.error(
    'Usage: node infra/account-request.mjs export <uid>\n' +
      '       node infra/account-request.mjs delete <uid> [--apply --confirmed-reply YYYY-MM-DD]',
  )
  process.exit(2)
}

/**
 * The date of the reply that confirmed a deletion, from `--confirmed-reply <date>`: a
 * real day within the last CONFIRMATION_MAX_DAYS days, or null when it is missing.
 */
export function confirmedReply(args, now = new Date()) {
  const index = args.indexOf('--confirmed-reply')
  if (index === -1) return null
  const value = args[index + 1] ?? ''
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null
  if (!day || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) {
    usage('--confirmed-reply takes the date of the confirming reply, as YYYY-MM-DD.')
  }
  const age = now.getTime() - day.getTime()
  if (age < -24 * 60 * 60 * 1000 || age > CONFIRMATION_MAX_DAYS * 24 * 60 * 60 * 1000) {
    usage(`--confirmed-reply must be a date within the last ${CONFIRMATION_MAX_DAYS} days.`)
  }
  return value
}

/** A document and, under `collections`, every subcollection below it (paths only). */
async function readTree(ref) {
  const snapshot = await ref.get()
  const node = { path: ref.path, data: snapshot.exists ? true : null }
  const collections = {}
  for (const collection of await ref.listCollections()) {
    const docs = []
    for (const doc of await collection.listDocuments()) docs.push(await readTree(doc))
    collections[collection.id] = docs
  }
  if (Object.keys(collections).length > 0) node.collections = collections
  return node
}

/** Every path under `tree`, documents first, for the deletion list. */
function paths(tree) {
  const out = tree.data === null ? [] : [tree.path]
  for (const docs of Object.values(tree.collections ?? {})) {
    for (const doc of docs) out.push(...paths(doc))
  }
  return out
}

async function outsideRecords(db, uid) {
  const refs = []
  for (const name of BY_UID) {
    const snapshot = await db.collection(name).where('uid', '==', uid).get()
    refs.push(...snapshot.docs.map(doc => doc.ref))
  }
  for (const name of BY_ID) {
    const ref = db.collection(name).doc(uid)
    if ((await ref.get()).exists) refs.push(ref)
  }
  return refs
}

async function authUser(auth, uid) {
  try {
    return await auth.getUser(uid)
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return null
    throw error
  }
}

async function main() {
  const [command, uid, ...rest] = process.argv.slice(2)
  if (!['export', 'delete'].includes(command)) usage()
  if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid))
    usage('Give the account uid (Firebase Authentication, Users).')
  const apply = rest.includes('--apply')
  const confirmed = command === 'delete' ? confirmedReply(rest) : null
  if (apply && !confirmed) {
    usage(
      'Deleting needs --confirmed-reply YYYY-MM-DD: reply to the account address and delete only once it confirms (docs/RUNBOOK.md).',
    )
  }

  const app = initializeApp({ projectId: PROJECT_ID })
  const db = getFirestore(app)
  const auth = getAuth(app)

  const user = await authUser(auth, uid)
  const tree = await readTree(db.collection('users').doc(uid))
  const outside = await outsideRecords(db, uid)

  if (command === 'export') {
    // The Account data page's own file, so the copy leaves out what the app leaves out.
    const { readAccountExport } = require('./lib/account/export.js')
    const copy = {
      exportedAt: new Date().toISOString(),
      project: PROJECT_ID,
      signIn: user && {
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        photoURL: user.photoURL ?? null,
        providers: user.providerData.map(p => p.providerId),
        createdAt: user.metadata.creationTime,
        lastSignInAt: user.metadata.lastSignInTime,
      },
      account: await readAccountExport({ db, uid }),
    }
    process.stdout.write(`${JSON.stringify(copy, null, 2)}\n`)
    return
  }

  const account = (await db.collection('users').doc(uid).get()).data()
  if (account?.stripeCustomerId || tree.collections?.billingResources?.length) {
    console.error(
      'This account has billing records. Delete it with the Account data controls page or the deleteAccount Function, which also cancels Stripe (docs/RUNBOOK.md).',
    )
    process.exit(1)
  }
  const listed = [...paths(tree), ...outside.map(ref => ref.path)]
  console.error(`${listed.length} Firestore documents${user ? ' and the Auth user' : ''}:`)
  for (const path of listed) console.error(`  ${path}`)
  if (user) console.error(`  auth: ${user.uid} ${user.email ?? ''}`)
  if (!apply) {
    console.error('Nothing deleted. Run again with --apply to delete these.')
    return
  }
  console.error(`Deleting, as confirmed by the reply of ${confirmed}.`)
  await db.recursiveDelete(db.collection('users').doc(uid))
  await Promise.all(outside.map(ref => ref.delete()))
  if (user) await auth.deleteUser(uid)
  const left = paths(await readTree(db.collection('users').doc(uid)))
  if (left.length > 0 || (await authUser(auth, uid))) {
    console.error('Something is left; run the command again.')
    process.exit(1)
  }
  console.error('Deleted. Nothing is left for this uid.')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
