#!/usr/bin/env node
// Shows which Hosting sites a `firebase deploy --only <only> --project <project>`
// would publish, resolved by the locked firebase-tools from firebase.json and
// .firebaserc exactly as the deploy resolves them, without deploying anything.
//
// firebase.json names its Hosting configs by target (`app`, `redirect`), and
// .firebaserc maps each target to a site per project, so one config deploys to
// production's sites or to the staging project's site.
//
// Usage:
//   node .github/scripts/check-hosting-target.js <project> <only> [--expect <site,...>]
//   node .github/scripts/check-hosting-target.js solara-staging hosting:app --expect solara-staging
//
// With --expect it fails unless the resolved sites are exactly that list, in order.
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const functionsDir = path.join(root, 'functions')
const fromFunctions = request => require(require.resolve(request, { paths: [functionsDir] }))

/**
 * The Hosting configs a deploy would publish, each with its resolved `site`.
 * @param {{ project: string, only: string, cwd?: string }} options
 * @returns {Array<Record<string, unknown> & { site: string }>}
 */
function resolveHosting({ project, only, cwd = root }) {
  const { Config } = fromFunctions('firebase-tools/lib/config.js')
  const { RC } = fromFunctions('firebase-tools/lib/rc.js')
  const { hostingConfig } = fromFunctions('firebase-tools/lib/hosting/config.js')
  const options = { cwd, projectRoot: cwd, project, only }
  options.config = Config.load(options)
  options.rc = RC.loadFile(path.join(cwd, '.firebaserc'))
  return hostingConfig(options)
}

module.exports = { resolveHosting }

function main(argv) {
  const [project, only] = argv
  const expectIndex = argv.indexOf('--expect')
  const expected = expectIndex === -1 ? null : (argv[expectIndex + 1] ?? '').split(',')
  if (!project || !only) {
    console.log('Usage: check-hosting-target.js <project> <only> [--expect <site,...>]')
    process.exit(2)
  }
  let sites
  try {
    sites = resolveHosting({ project, only }).map(config => config.site)
  } catch (error) {
    console.log(`::error::Hosting targets do not resolve for ${project}: ${error.message}`)
    process.exit(1)
  }
  console.log(`firebase deploy --only ${only} --project ${project} publishes: ${sites.join(', ')}`)
  if (expected && sites.join(',') !== expected.join(',')) {
    console.log(`::error::Expected exactly ${expected.join(', ')}, got ${sites.join(', ')}.`)
    process.exit(1)
  }
}

if (require.main === module) main(process.argv.slice(2))
