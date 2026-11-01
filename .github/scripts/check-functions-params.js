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
// The deploy analyzes the source with the dotenv values as its environment, so
// SOLARA_FUNCTION_SET in them picks the set it loads (functions/src/function-set.ts); this
// check loads the same set. The budget guard set (`budget-guard`) must declare no secret
// at all: it deploys before any of the other Functions' secrets exist.
//
// For every other set it also checks APP_URL, the origin the Functions' CORS allows and checkout returns
// to: production's own origin for production, and never one of production's hosts for
// any other project, so neither project's origin can leak into the other.
//
// With --expect-set=<set> it also fails unless the deploy would load that set, so the
// full Functions deploy (which prunes with --force) can never run on the budget guard
// alone, and the guard deploy never on every Function.
//
// Usage: node .github/scripts/check-functions-params.js [projectId] [--expect-set=all|budget-guard]
const path = require('node:path')
const PRODUCTION = require('./production.json')

/** Hosts that belong to production: its Hosting sites and the Firebase auth domain. */
const PRODUCTION_HOSTS = new Set(
  [...PRODUCTION.hostingSites, PRODUCTION.projectId].flatMap(name => [
    `${name}.web.app`,
    `${name}.firebaseapp.com`,
  ]),
)

/**
 * The problem with a project's APP_URL, or null. Pure, for tests.
 * @param {string} projectId
 * @param {string} appUrl
 * @returns {string | null}
 */
function checkAppUrl(projectId, appUrl) {
  if (!appUrl) return `APP_URL is empty for ${projectId}; set it in functions/.env.${projectId}.`
  let url
  try {
    url = new URL(appUrl)
  } catch {
    return `APP_URL (${appUrl}) is not a URL.`
  }
  if (url.origin !== appUrl.replace(/\/$/, '')) {
    return `APP_URL (${appUrl}) must be an origin, with no path, query or fragment.`
  }
  if (url.protocol !== 'https:') return `APP_URL (${appUrl}) must use https.`
  if (projectId === PRODUCTION.projectId) {
    return url.origin === PRODUCTION.appUrl
      ? null
      : `APP_URL for production is ${appUrl}, not ${PRODUCTION.appUrl}.`
  }
  return PRODUCTION_HOSTS.has(url.hostname)
    ? `APP_URL for ${projectId} is production's ${url.hostname}; give the project its own origin.`
    : null
}

/**
 * The problem with the params a Functions set declares, or null. Pure, for tests.
 * @param {string} set the SOLARA_FUNCTION_SET value ('' is every Function)
 * @param {{ name: string, type: string }[]} params
 * @returns {string | null}
 */
function checkSetParams(set, params) {
  if (set !== 'budget-guard') return null
  const secrets = params.filter(param => param.type === 'secret').map(param => param.name)
  return secrets.length
    ? `the budget guard alone declares secrets (${secrets.join(', ')}); it must deploy without them.`
    : null
}

module.exports = { checkAppUrl, checkSetParams }

const args = process.argv.slice(2)
const projectId =
  args.find(arg => !arg.startsWith('--')) || process.env.FIREBASE_PROJECT_ID || PRODUCTION.projectId
const expectedSet = args.find(arg => arg.startsWith('--expect-set='))?.slice('--expect-set='.length)
const root = path.resolve(__dirname, '..', '..')
const functionsDir = path.join(root, 'functions')
const fromFunctions = request => require(require.resolve(request, { paths: [functionsDir] }))

async function main() {
  const { loadUserEnvs } = fromFunctions('firebase-tools/lib/functions/env.js')
  const userEnvs = loadUserEnvs({ functionsSource: functionsDir, projectDir: root, projectId })
  // The deploy's analysis sees the dotenv values as its environment.
  const set = String(userEnvs.SOLARA_FUNCTION_SET ?? '').trim()
  process.env.SOLARA_FUNCTION_SET = set
  if (expectedSet !== undefined && (set || 'all') !== expectedSet) {
    throw new Error(
      `the deploy would load the ${set || 'all'} Functions set, not ${expectedSet} (SOLARA_FUNCTION_SET in functions/.env.${projectId}).`,
    )
  }
  try {
    require(functionsDir)
  } catch (error) {
    throw new Error(
      `the Functions entry point fails to load, so no deploy can analyze it (run npm run build --prefix functions first): ${error.message}`,
    )
  }
  const { declaredParams } = fromFunctions('firebase-functions/params')
  const { resolveParams } = fromFunctions('firebase-tools/lib/deploy/functions/params.js')

  const params = declaredParams.map(param => param.toSpec())
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
  const setProblem = checkSetParams(set, params)
  if (setProblem) throw new Error(setProblem)
  // The budget guard alone serves no browser, so it has no APP_URL.
  if (set !== 'budget-guard') {
    const appUrlProblem = checkAppUrl(projectId, String(paramValues.APP_URL ?? ''))
    if (appUrlProblem) throw new Error(appUrlProblem)
  }
  console.log(
    `All ${params.length} Functions params of the ${set || 'all'} set resolve non-interactively for ${projectId}.`,
  )
}

if (require.main === module) {
  main().catch(error => {
    console.log(`::error::Functions params do not resolve: ${error.message}`)
    process.exit(1)
  })
}
