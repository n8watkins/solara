import type { ErrorEvent } from '@sentry/nextjs'
import { describe, expect, it } from 'vitest'
import { sentryOptions } from './sentry-options'

const DSN = 'https://abc123public@o11.ingest.us.sentry.io/22'

describe('sentryOptions', () => {
  const options = sentryOptions(DSN, 'commit-sha')

  it('reports errors only: no tracing, no replay, no per-page-load sessions', () => {
    expect(options.tracesSampleRate).toBe(0)
    const defaults = [
      'InboundFilters',
      'BrowserTracing',
      'BrowserSession',
      'GlobalHandlers',
      'Breadcrumbs',
    ].map(name => ({ name }))
    const integrations = options.integrations as (
      defaults: { name: string }[],
    ) => { name: string }[]
    expect(integrations(defaults).map(integration => integration.name)).toEqual([
      'InboundFilters',
      'GlobalHandlers',
      'Breadcrumbs',
    ])
  })

  it('collects no user data, IP address, cookies, query strings or variables', () => {
    expect(options.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    })
  })

  it('scrubs every event and breadcrumb before sending', () => {
    const event = {
      type: undefined,
      message: 'failed for someone@example.com',
      user: { id: 'u' },
    } satisfies ErrorEvent
    const sent = options.beforeSend?.(event, {}) as ErrorEvent
    expect(sent.message).toBe('failed for [email]')
    expect(sent.user).toBeUndefined()
    expect(options.beforeBreadcrumb?.({ message: 'someone@example.com' })).toEqual({
      message: '[email]',
    })
  })

  it('tags the release and production environment', () => {
    expect(options).toMatchObject({ dsn: DSN, release: 'commit-sha', environment: 'production' })
    expect(sentryOptions(DSN).release).toBeUndefined()
  })
})
