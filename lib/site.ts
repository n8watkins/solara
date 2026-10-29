export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://solara-uv.web.app').replace(
  /\/+$/,
  '',
)

/**
 * A staging build (deploy-staging.yml sets NEXT_PUBLIC_DEPLOY_ENVIRONMENT=staging): kept
 * out of search engines, so the staging copy never competes with the real site.
 */
export const IS_STAGING = process.env.NEXT_PUBLIC_DEPLOY_ENVIRONMENT === 'staging'
