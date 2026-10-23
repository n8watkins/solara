#!/usr/bin/env node
// Proves that `firebase deploy --only functions --non-interactive` can resolve
// every Functions parameter, without deploying anything.
//
// It loads the Functions entry point (package.json "main", the compiled
// functions/lib/index.js from `npm run build --prefix functions`) the way the deploy does (so a source that crashes
// on load fails here too), reads the declared params, and runs them through the
// locked firebase-tools resolver with the dotenv files the deploy would read
// (functions/.env and functions/.env.<project>). Secret params are skipped: they
// live in Secret Manager and are checked by the deploy itself.
//
// Usage: node .github/scripts/check-functions-params.js [projectId]
const path = require('node:path')

const projectId = process.argv[2] || process.env.FIREBASE_PROJECT_ID || 'uv-activity-planner'
const root = path.resolve(__dirname, '..', '..')
const functionsDir = path.join(root, 'functions')
const fromFunctions = request => require(require.resolve(request, { paths: [functionsDir] }))

async function main() {
  try {
    require(functionsDir)
  } catch (error) {
    throw new Error(
      `the Functions entry point fails to load, so no deploy can analyze it (run npm run build --prefix functions first): ${error.message}`,
    )
  }
  const { declaredParams } = fromFunctions('firebase-functions/params')
  const { loadUserEnvs } = fromFunctions('firebase-tools/lib/functions/env.js')
  const { resolveParams } = fromFunctions('firebase-tools/lib/deploy/functions/params.js')

  const params = declaredParams.map(param => param.toSpec())
  const userEnvs = loadUserEnvs({ functionsSource: functionsDir, projectDir: root, projectId })
  const { paramValues } = await resolveParams({
    params,
    firebaseConfig: { projectId },
    userEnvs,
    nonInteractive: true,
    // Skips Secret Manager lookups only; string params resolve exactly as on deploy.
    isEmulator: true,
  })

  for (const param of params.filter(p => p.type !== 'secret')) {
    console.log(`${param.name} = ${JSON.stringify(String(paramValues[param.name] ?? ''))}`)
  }
  console.log(`All ${params.length} Functions params resolve non-interactively for ${projectId}.`)
}

main().catch(error => {
  console.log(`::error::Functions params do not resolve: ${error.message}`)
  process.exit(1)
})
