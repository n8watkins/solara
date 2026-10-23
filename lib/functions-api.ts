import {
  parseFunctionError,
  parseFunctionResponse,
  type FunctionName,
  type FunctionResponse,
} from '@solara/core'
import type { User } from 'firebase/auth'
import { appCheckConfigured, appCheckToken } from './firebase'

// One client for the browser-called Cloud Functions. Each request carries the user's
// Firebase ID token and an App Check token; the server answers errors as
// `{ error, code }` with a code from a fixed allowlist (functions/src/shared/errors.ts).
// Success bodies are validated against the endpoint's contract in @solara/core
// (FUNCTION_RESPONSES), so callers get typed data or a FunctionsApiError.

export function functionsBaseUrl(): string | null {
  return process.env.NEXT_PUBLIC_FUNCTIONS_URL?.replace(/\/$/, '') || null
}

/** Whether the protected Functions endpoints can be called from this build. */
export function functionsApiConfigured(): boolean {
  return !!functionsBaseUrl() && appCheckConfigured()
}

export class FunctionsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message)
    this.name = 'FunctionsApiError'
  }
}

export interface CallOptions {
  method: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  /** Mint a single-use App Check token the server consumes (replay protection). */
  limitedUse?: boolean
  /** Force a fresh ID token, for endpoints that check how recently the user signed in. */
  freshIdToken?: boolean
  /** Shown when the server gives no usable message. */
  fallbackMessage: string
}

export async function callFunction<Name extends FunctionName>(
  user: User,
  path: Name,
  { method, body, limitedUse = false, freshIdToken = false, fallbackMessage }: CallOptions,
): Promise<FunctionResponse<Name>> {
  const baseUrl = functionsBaseUrl()
  if (!baseUrl || !appCheckConfigured()) {
    throw new FunctionsApiError('Account services are not configured yet.', 0, 'not-configured')
  }
  const [idToken, appCheck] = await Promise.all([
    user.getIdToken(freshIdToken),
    appCheckToken({ limitedUse }),
  ])
  if (!appCheck) throw new FunctionsApiError(fallbackMessage, 0, 'app-check-required')

  const response = await fetch(`${baseUrl}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${idToken}`,
      'X-Firebase-AppCheck': appCheck,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = parseFunctionError(result)
    throw new FunctionsApiError(error.error ?? fallbackMessage, response.status, error.code ?? null)
  }
  const data = parseFunctionResponse(path, result)
  if (!data) throw new FunctionsApiError(fallbackMessage, response.status, 'invalid-response')
  return data
}
