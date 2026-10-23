// Shared JSDoc types for the type-checked Functions code (see tsconfig.json).

import type { Auth } from 'firebase-admin/auth'
import type {
  DocumentData,
  DocumentReference,
  FieldValue,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore'
import type { Request } from 'firebase-functions/v2/https'
import type Stripe from 'stripe'

export type { Auth, DocumentData, DocumentReference, Firestore, Request, Transaction }

export type StripeClient = Stripe

/**
 * A Stripe API object read defensively (checkout sessions, subscriptions, events, list
 * pages). The billing code validates every field it uses at runtime, so it is typed
 * loosely here until the Functions move to TypeScript (plan lane W2-B).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StripeRecord = any

export type ServerTimestamp = () => FieldValue

export type BillingResourceType = 'checkoutSession' | 'customer' | 'subscription'

export interface BillingResource {
  type: BillingResourceType | string
  stripeId: string | null | undefined
  verified?: boolean
}

/** A cleanup resource claimed under a processing lease. */
export interface ClaimedResource {
  id: string
  ref: DocumentReference
  data: () => DocumentData
}
