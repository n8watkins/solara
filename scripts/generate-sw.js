// Bundles scripts/sw/firebase-messaging-sw.ts into public/firebase-messaging-sw.js
// with the npm Firebase SDK and the public web config baked in. Runs before
// `next dev` and `next build` (predev/prebuild).
require('dotenv').config({ path: '.env.local', quiet: true })
const path = require('path')

const root = path.join(__dirname, '..')
const outFile = path.join(root, 'public', 'firebase-messaging-sw.js')

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
}

async function main() {
  const { build } = await import('rolldown')
  await build({
    input: path.join(root, 'scripts', 'sw', 'firebase-messaging-sw.ts'),
    platform: 'browser',
    logLevel: 'warn',
    transform: { define: { __FIREBASE_CONFIG__: JSON.stringify(config) } },
    output: {
      file: outFile,
      format: 'iife',
      minify: true,
      sourcemap: false,
    },
  })
  console.log('✓ firebase-messaging-sw.js bundled')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
