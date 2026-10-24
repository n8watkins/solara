// Playwright global setup for the signed-in suite: waits until the emulators answer
// the requests the app makes, not just until their ports are open.
//
// `firebase emulators:exec` starts the tests as soon as every emulator listens. The
// Firestore emulator still has to load its rules engine and the code paths for
// security-rules checks, listens and transactions on the first such requests, which
// on a busy machine takes several seconds. Without this, the first tests of a run
// measure that warm-up instead of the app, and their assertions time out on a
// sign-in that is still waiting for its first Firestore answer.
import { randomUUID } from 'node:crypto'
import { accountPrefs, AUTH_URL, encode, FIRESTORE_API } from './fixtures'

async function timed(label: string, request: () => Promise<Response>): Promise<Response> {
  const started = performance.now()
  const response = await request()
  if (response.status >= 500) {
    throw new Error(`signed-in warm-up: ${label} failed with ${response.status}`)
  }
  console.log(
    `signed-in warm-up: ${label} ${response.status} in ${Math.round(performance.now() - started)} ms`,
  )
  return response
}

export default async function warmUp(): Promise<void> {
  // A new Google account, signed in the way the emulator's sign-in page does it.
  const id = randomUUID().slice(0, 8)
  const signedIn = await timed('sign-in', () =>
    fetch(`${AUTH_URL}/v1/accounts:signInWithIdp?key=demo-api-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: new URLSearchParams({
          id_token: JSON.stringify({ sub: `google-warm-${id}`, email: `warm.${id}@example.com` }),
          providerId: 'google.com',
        }).toString(),
        requestUri: 'http://localhost',
        returnSecureToken: true,
      }),
    }),
  )
  const { localId: uid, idToken } = (await signedIn.json()) as { localId: string; idToken: string }
  const headers = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }
  const document = `${FIRESTORE_API}/users/${uid}`
  const name = document.slice(document.indexOf('/projects/') + 1)

  // What the app does for a brand-new account: a rules-checked read, then the
  // createAccountPrefs transaction (read and create in one commit).
  await timed('rules-checked read', () => fetch(document, { headers }))
  const begun = await timed('begin transaction', () =>
    fetch(`${FIRESTORE_API}:beginTransaction`, { method: 'POST', headers, body: '{}' }),
  )
  const { transaction } = (await begun.json()) as { transaction: string }
  await timed('transaction read', () =>
    fetch(`${FIRESTORE_API}:batchGet`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ documents: [name], transaction }),
    }),
  )
  await timed('transaction commit', () =>
    fetch(`${FIRESTORE_API}:commit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        transaction,
        writes: [
          {
            update: {
              name,
              fields: (encode(accountPrefs(uid)) as { mapValue: { fields: unknown } }).mapValue
                .fields,
            },
            currentDocument: { exists: false },
          },
        ],
      }),
    }),
  )
  await timed('rules-checked read', () => fetch(document, { headers }))
}
