const { createHash } = require('node:crypto')

const BILLING_RESOURCE_TYPES = new Set(['checkoutSession', 'customer', 'subscription'])

function validBillingResource(type, stripeId) {
  return BILLING_RESOURCE_TYPES.has(type) && typeof stripeId === 'string' && stripeId.length > 0
}

function billingResourceRef(userRef, type, stripeId) {
  if (!validBillingResource(type, stripeId)) return null
  const digest = createHash('sha256').update(`${type}\0${stripeId}`).digest('base64url')
  return userRef.collection('billingResources').doc(`${type}_${digest}`)
}

function indexBillingResources(transaction, userRef, resources, timestamp) {
  for (const { type, stripeId } of resources) {
    const ref = billingResourceRef(userRef, type, stripeId)
    if (!ref) continue
    transaction.set(ref, { type, stripeId, updatedAt: timestamp }, { merge: true })
  }
}

function stripeSessionBelongsToUser(session, uid) {
  return session?.client_reference_id === uid || session?.metadata?.firebaseUid === uid
}

async function listCustomerCheckoutSessions(stripe, customerId) {
  const sessions = []
  let startingAfter
  do {
    const page = await stripe.checkout.sessions.list({
      customer: customerId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    sessions.push(...page.data)
    startingAfter = page.has_more ? page.data.at(-1)?.id : null
    if (page.has_more && !startingAfter) throw new Error('Stripe checkout pagination was incomplete')
  } while (startingAfter)
  return sessions
}

async function customerBelongsToUser(stripe, customerId, uid) {
  const sessions = await listCustomerCheckoutSessions(stripe, customerId)
  return sessions.some(session => stripeSessionBelongsToUser(session, uid))
}

module.exports = {
  billingResourceRef,
  customerBelongsToUser,
  indexBillingResources,
  listCustomerCheckoutSessions,
  stripeSessionBelongsToUser,
  validBillingResource,
}
