// App Check for the Functions emulator, preloaded only by the signed-in e2e suite
// (tests/e2e/signed-in/run.mjs sets NODE_OPTIONS=--require <this file>).
//
// Every browser-called Function verifies an App Check token with the Admin SDK
// (functions/src/shared/app-check.ts). There is no App Check emulator, and real tokens, even
// debug ones, are minted by Google's servers, which the suite never contacts. So
// emulator builds of the web app mint opaque local tokens (see
// emulatorAppCheckProvider in lib/firebase-services.ts) and this file teaches the Admin SDK
// inside the Functions emulator to accept exactly those.
//
// Why this cannot weaken production:
// - It lives under tests/, outside functions/, so it is never part of the deployed
//   Functions source, and nothing in functions/ requires it.
// - It only patches when FUNCTIONS_EMULATOR is "true", which only the Functions
//   emulator sets; in any other process (including the firebase CLI and Playwright,
//   which inherit NODE_OPTIONS too) it does nothing.
// - Tokens without the emulator prefix still go through the real verifier, which
//   rejects them, so requests without a token keep failing as in production.
// - Limited-use tokens are consumed: replaying one reports `alreadyConsumed`, so the
//   server's replay protection behaves as in production.
'use strict'

// Keep in sync with emulatorAppCheckProvider in lib/firebase-services.ts.
const TOKEN_PREFIX = 'solara-firebase-emulators.'

if (process.env.FUNCTIONS_EMULATOR === 'true') {
  // The Functions runtime runs with functions/ as its working directory, so resolve
  // the same firebase-admin copy that the Functions code loads.
  const appCheckModule = require(
    require.resolve('firebase-admin/app-check', { paths: [process.cwd()] }),
  )
  const { AppCheck } = appCheckModule
  const verifyToken = AppCheck.prototype.verifyToken
  const consumed = new Set()

  AppCheck.prototype.verifyToken = async function emulatorVerifyToken(token, options) {
    if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) {
      return verifyToken.call(this, token, options)
    }
    const now = Math.floor(Date.now() / 1000)
    const decoded = {
      app_id: 'solara-emulator-app',
      aud: [`projects/${process.env.GCLOUD_PROJECT}`],
      exp: now + 3600,
      iat: now,
      iss: 'https://firebaseappcheck.googleapis.com/emulator',
      sub: 'solara-emulator-app',
    }
    if (!options?.consume) return { appId: decoded.app_id, token: decoded }
    const alreadyConsumed = consumed.has(token)
    consumed.add(token)
    return { alreadyConsumed, appId: decoded.app_id, token: decoded }
  }
}
