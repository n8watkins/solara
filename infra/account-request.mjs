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
// Usage, from the repository root after `npm ci --prefix functions`, signed in as the
// project owner with `gcloud auth application-default login`:
//   node infra/account-request.mjs export <uid> > solara-<uid>.json   # read only
//   node infra/account-request.mjs delete <uid>                       # lists what it would delete
//   node infra/account-request.mjs delete <uid> --apply               # deletes it
// PROJECT_ID defaults to uv-activity-planner. With FIRESTORE_EMULATOR_HOST and
// FIREBASE_AUTH_EMULATOR_HOST set, it works on the emulators instead.
import { createRequire } from 'node:module'

const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')

const PROJECT_ID = process.env.PROJECT_ID || 'uv-activity-planner'
// Top-level records that belong to one account, found by their `uid` field.
const BY_UID = ['calendarFeeds', 'eventSubscriptions', 'notificationTokenOwners']
// Top-level records keyed by the uid.
const BY_ID = ['notificationRegistrationLimits']
// Fields never copied out: a linked calendar's address can hold a private token
// (docs/RUNBOOK.md, "Linked calendars"), and the person has it already.
const SECRET_FIELDS = new Set(['url'])

function usage(message) {
  if (message) console.error(message)
  console.error('Usage: node infra/account-request.mjs export|delete <uid> [--apply]')
  process.exit(2)
}

/** Firestore values as plain JSON: timestamps as ISO text, references as paths. */
function plain(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (value && typeof value === 'object' && typeof value.path === 'string' && value.firestore) {
    return value.path
  }
  if (Array.isArray(value)) return value.map(plain)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]))
  }
  return value
}

/** A document and, under `collections`, every subcollection below it. */
async function readTree(ref) {
  const snapshot = await ref.get()
  const node = { path: ref.path, data: snapshot.exists ? plain(snapshot.data()) : null }
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

  const app = initializeApp({ projectId: PROJECT_ID })
  const db = getFirestore(app)
  const auth = getAuth(app)

  const user = await authUser(auth, uid)
  const tree = await readTree(db.collection('users').doc(uid))
  const outside = await outsideRecords(db, uid)

  if (command === 'export') {
    const outsideData = []
    for (const ref of outside) {
      const data = plain((await ref.get()).data())
      for (const field of SECRET_FIELDS) delete data[field]
      outsideData.push({ path: ref.path, data })
    }
    const copy = {
      exportedAt: new Date().toISOString(),
      project: PROJECT_ID,
      authUser: user && {
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        photoURL: user.photoURL ?? null,
        providers: user.providerData.map(p => p.providerId),
        createdAt: user.metadata.creationTime,
        lastSignInAt: user.metadata.lastSignInTime,
      },
      account: tree,
      otherRecords: outsideData,
    }
    process.stdout.write(`${JSON.stringify(copy, null, 2)}\n`)
    return
  }

  if (tree.data?.stripeCustomerId || tree.collections?.billingResources?.length) {
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

main().catch(error => {
  console.error(error)
  process.exit(1)
})
