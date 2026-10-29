// firebase.json names its Hosting configs by deploy target and .firebaserc maps each
// target to a site per project, so one config serves production and staging. These
// resolve the sites with the locked firebase-tools, the way `firebase deploy` does.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { resolveHosting } = require('../.github/scripts/check-hosting-target.js') as {
  resolveHosting: (options: { project: string; only: string }) => Array<{ site: string }>
}
const sites = (project: string, only: string) =>
  resolveHosting({ project, only }).map(config => config.site)

const rc = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8')) as {
  projects: Record<string, string>
  targets: Record<string, { hosting: Record<string, string[]> }>
}

describe('Hosting targets', () => {
  it('deploys production to its app site and the old address, as before', () => {
    expect(rc.projects.default).toBe('uv-activity-planner')
    expect(sites('uv-activity-planner', 'hosting')).toEqual(['solara-uv', 'uv-activity-planner'])
    expect(sites('uv-activity-planner', 'hosting:app')).toEqual(['solara-uv'])
  })

  it('deploys staging to its own site only', () => {
    expect(rc.projects.staging).toBe('solara-staging')
    expect(sites('solara-staging', 'hosting:app')).toEqual(['solara-staging'])
  })

  it('refuses a full Hosting deploy to staging, which has no redirect site', () => {
    expect(() => sites('solara-staging', 'hosting')).toThrow(/redirect not configured/)
  })

  it('refuses a project with no mapping instead of guessing a site', () => {
    expect(() => sites('some-other-project', 'hosting:app')).toThrow(/app not configured/)
  })

  it('never maps a production site to another project', () => {
    const production = Object.values(rc.targets['uv-activity-planner']!.hosting).flat()
    for (const [project, targets] of Object.entries(rc.targets)) {
      if (project === 'uv-activity-planner') continue
      for (const site of Object.values(targets.hosting).flat()) {
        expect(production).not.toContain(site)
      }
    }
  })

  it('names every Hosting config by target, never by a fixed site', () => {
    const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'))
    for (const hosting of config.hosting) {
      expect(hosting.site).toBeUndefined()
      expect(['app', 'redirect']).toContain(hosting.target)
    }
  })
})
