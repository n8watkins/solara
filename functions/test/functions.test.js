const { afterEach, describe, test } = require('node:test')
const assert = require('node:assert/strict')

const {
  authenticate,
  deleteAccount,
  exportAccountData,
  processAccountDeletionPage,
  processPendingAccountDeletions,
  safeAccountData,
} = require('../lib/account')
const { queueBillingCleanup, subscriptionOwnerRef } = require('../lib/billing-resources')
const { handleCors } = require('../lib/http')
const {
  cachedForecast,
  clearForecastCache,
  createCalendarFeedHandler,
  validCoordinates,
  validFeedToken,
} = require('../lib/calendar-feed')
const {
  backfillBillingResourcePage,
  createBillingPortal,
  createCheckout,
  processStripeEvent,
  subscriptionHasPrice,
  validAttemptId,
  validUid,
  validateCheckoutSession,
} = require('../lib/stripe')

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    set(name, value) { this.headers[name] = value; return this },
    status(code) { this.statusCode = code; return this },
    send(body) { this.body = body; return this },
  }
}

function queryWith(doc) {
  return {
    where() { return this },
    limit() { return this },
    async get() { return { empty: !doc, docs: doc ? [doc] : [] } },
  }
}

function withBillingResources(ref, initialResources = []) {
  const resources = new Map(initialResources.map(resource => [resource.id, { ...resource }]))
  ref.collection = name => {
    assert.equal(name, 'billingResources')
    return {
      doc(id) {
        return {
          id,
          kind: 'billingResource',
          parent: { parent: ref },
          async get() {
            return { exists: resources.has(id), data: () => ({ ...resources.get(id) }) }
          },
        }
      },
      async get() {
        return {
          docs: [...resources.entries()].map(([id, data]) => ({
            id,
            data: () => ({ ...data }),
          })),
        }
      },
    }
  }
  ref.billingResources = resources
  return ref
}

function fakeDb(initialUser) {
  const subscriptionOwners = new Map()
  const cleanupResources = new Map()
  const events = new Map()
  const tombstoneData = {}
  const userData = { ...initialUser }
  const userRef = withBillingResources({
    id: 'alice',
    kind: 'user',
    async get() {
      return { exists: initialUser !== null, data: () => ({ ...userData }), ref: userRef }
    },
  })
  const database = {
    subscriptionOwners,
    cleanupResources,
    tombstoneData,
    userData,
    collection(name) {
      if (name === 'users') {
        const doc = initialUser === null ? null : { ref: userRef, data: () => ({ ...userData }) }
        const query = queryWith(doc)
        query.doc = () => userRef
        return query
      }
      if (name === 'stripeWebhookEvents') {
        return {
          doc(id) {
            return {
              id,
              kind: 'event',
              async get() {
                return { exists: events.has(id), data: () => ({ ...events.get(id) }) }
              },
              async set(data) { events.set(id, { ...events.get(id), ...data }) },
            }
          },
        }
      }
      if (name === 'stripeSubscriptionOwners') {
        return {
          doc(id) {
            return {
              id,
              kind: 'subscriptionOwner',
              async get() {
                return {
                  exists: subscriptionOwners.has(id),
                  data: () => ({ ...subscriptionOwners.get(id) }),
                }
              },
            }
          },
        }
      }
      if (name === 'accountDeletionTombstones') {
        return {
          doc() {
            const tombstoneRef = {
              kind: 'tombstone',
              async get() {
                return {
                  exists: Object.keys(tombstoneData).length > 0,
                  data: () => ({ ...tombstoneData }),
                }
              },
              collection(collectionName) {
                assert.equal(collectionName, 'billingCleanupResources')
                return {
                  doc(id) {
                    return {
                      id,
                      kind: 'cleanupResource',
                      async get() {
                        return {
                          exists: cleanupResources.has(id),
                          data: () => ({ ...cleanupResources.get(id) }),
                        }
                      },
                    }
                  },
                }
              },
            }
            return tombstoneRef
          },
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    },
    collectionGroup(name) {
      assert.equal(name, 'billingResources')
      let stripeId
      return {
        where(_field, _operator, value) { stripeId = value; return this },
        limit() { return this },
        async get() {
          const entry = [...userRef.billingResources.entries()]
            .find(([, resource]) => resource.stripeId === stripeId)
          if (!entry) return { empty: true, docs: [] }
          const [id, data] = entry
          return {
            empty: false,
            docs: [{
              data: () => ({ ...data }),
              ref: userRef.collection('billingResources').doc(id),
            }],
          }
        },
      }
    },
    async runTransaction(callback) {
      const operations = []
      const result = await callback({
        async get(ref) { return ref.get() },
        set(ref, data) {
          operations.push(() => {
            if (ref.kind === 'event') events.set(ref.id, { ...events.get(ref.id), ...data })
            else if (ref.kind === 'tombstone') Object.assign(tombstoneData, data)
            else if (ref.kind === 'cleanupResource') {
              cleanupResources.set(ref.id, { ...cleanupResources.get(ref.id), ...data })
            }
            else if (ref.kind === 'billingResource') {
              userRef.billingResources.set(ref.id, {
                ...userRef.billingResources.get(ref.id),
                ...data,
              })
            }
            else if (ref.kind === 'subscriptionOwner') {
              subscriptionOwners.set(ref.id, {
                ...subscriptionOwners.get(ref.id),
                ...data,
              })
            }
            else Object.assign(userData, data)
          })
          return this
        },
        create(ref, data) { operations.push(() => events.set(ref.id, { ...data })); return this },
      })
      operations.forEach(operation => operation())
      return result
    },
  }
  return database
}

function fakeDeletionDb({ cleanup = [], resources = [], tombstone = {}, user = {} } = {}) {
  const subscriptionOwners = new Map()
  const deleted = []
  const userResources = new Map(resources.map(resource => [resource.id, { ...resource }]))
  const cleanupResources = new Map(cleanup.map(resource => [resource.id, { ...resource }]))
  const tombstoneData = { ...tombstone }
  const userData = { ...user }

  const cleanupCollection = {
    doc(id) {
      return {
        id,
        async get() {
          return { exists: cleanupResources.has(id), data: () => ({ ...cleanupResources.get(id) }) }
        },
        async set(data) {
          cleanupResources.set(id, { ...cleanupResources.get(id), ...data })
        },
      }
    },
    where(field, _operator, value) {
      if (field === 'status') {
        this.dueBefore = null
        this.orderField = null
      } else if (field === 'nextAttemptAt') {
        this.dueBefore = value
      }
      return this
    },
    orderBy(field) { this.orderField = field; return this },
    limit(value) { this.pageSize = value; return this },
    async get() {
      const entries = [...cleanupResources.entries()]
        .filter(([, data]) => data.status === 'pending')
        .filter(([, data]) => !this.dueBefore
          || !data.nextAttemptAt
          || data.nextAttemptAt <= this.dueBefore)
      if (this.orderField) {
        entries.sort(([, left], [, right]) => {
          const leftTime = left[this.orderField]?.getTime?.() || 0
          const rightTime = right[this.orderField]?.getTime?.() || 0
          return leftTime - rightTime
        })
      }
      const docs = entries
        .slice(0, this.pageSize)
        .map(([id, data]) => ({ id, ref: this.doc(id), data: () => ({ ...data }) }))
      return { docs, empty: docs.length === 0 }
    },
  }
  const tombstoneRef = {
    id: 'alice',
    async get() {
      return {
        exists: Object.keys(tombstoneData).length > 0,
        data: () => ({ ...tombstoneData }),
      }
    },
    async set(data) { Object.assign(tombstoneData, data) },
    collection(name) { assert.equal(name, 'billingCleanupResources'); return cleanupCollection },
  }
  const userCollection = {
    cursor: null,
    pageSize: 25,
    orderBy() { return this },
    limit(value) { this.pageSize = value; return this },
    startAfter(value) { this.cursor = value; return this },
    async get() {
      const entries = [...userResources.entries()]
      const start = this.cursor ? entries.findIndex(([id]) => id === this.cursor) + 1 : 0
      return {
        docs: entries.slice(start, start + this.pageSize).map(([id, data]) => ({
          id,
          data: () => ({ ...data }),
        })),
      }
    },
  }
  const userRef = {
    async get() { return { exists: true, data: () => ({ ...userData }) } },
    async set(data) { Object.assign(userData, data) },
    collection(name) { assert.equal(name, 'billingResources'); return userCollection },
  }
  const db = {
    subscriptionOwners,
    cleanupResources,
    deleted,
    tombstoneData,
    userData,
    collection(name) {
      if (name === 'users') return { doc: () => userRef }
      if (name === 'accountDeletionTombstones') return { doc: () => tombstoneRef }
      if (name === 'notificationTokenOwners') {
        return { where: () => ({ get: async () => ({ docs: [] }) }) }
      }
      if (name === 'notificationRegistrationLimits') {
        return { doc: () => ({ delete: async () => deleted.push('limit') }) }
      }
      if (name === 'stripeSubscriptionOwners') {
        return { doc: id => ({
          async set(data) {
            subscriptionOwners.set(id, { ...subscriptionOwners.get(id), ...data })
          },
        }) }
      }
      throw new Error(`Unexpected collection ${name}`)
    },
    async recursiveDelete(ref) { assert.equal(ref, userRef); deleted.push('user') },
    async runTransaction(callback) {
      const writes = []
      const result = await callback({
        get: ref => ref.get(),
        set: (ref, data) => writes.push(() => ref.set(data)),
      })
      for (const write of writes) await write()
      return result
    },
  }
  return { db, tombstoneRef }
}

function deletionAuth(db) {
  return {
    deleteUser: async uid => db.deleted.push(`auth:${uid}`),
    revokeRefreshTokens: async uid => db.deleted.push(`sessions:${uid}`),
  }
}

afterEach(clearForecastCache)

describe('account data security', () => {
  test('preserves completed cleanup and verified ownership on rediscovery', async () => {
    const stored = {
      status: 'completed',
      verified: true,
    }
    const ref = {
      get: async () => ({ exists: false, data: () => ({}) }),
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => ({ ...stored }) }),
          set: async data => Object.assign(stored, data),
        }),
      }),
    }
    const writes = []
    await queueBillingCleanup({
      get: resourceRef => resourceRef.get(),
      set: (resourceRef, data) => writes.push(() => resourceRef.set(data)),
    }, ref, [{ type: 'customer', stripeId: 'cus_complete', verified: false }], new Date())
    for (const write of writes) await write()

    assert.equal(stored.status, 'completed')
    assert.equal(stored.verified, true)
  })

  test('reopens ownership-rejected cleanup after verified rediscovery', async () => {
    const stored = {
      nextAttemptAt: null,
      ownershipRejected: true,
      status: 'completed',
      verified: false,
    }
    const tombstone = {}
    const resourceRef = {
      get: async () => ({ exists: true, data: () => ({ ...stored }) }),
      set: async data => Object.assign(stored, data),
    }
    const tombstoneRef = {
      collection: () => ({ doc: () => resourceRef }),
      get: async () => ({ exists: false, data: () => ({}) }),
      set: async data => Object.assign(tombstone, data),
    }
    const writes = []
    const timestamp = new Date()
    await queueBillingCleanup({
      get: ref => ref.get(),
      set: (ref, data) => writes.push(() => ref.set(data)),
    }, tombstoneRef, [{ type: 'subscription', stripeId: 'sub_rejected' }], timestamp)
    for (const write of writes) await write()

    assert.equal(stored.status, 'pending')
    assert.equal(stored.nextAttemptAt, timestamp)
    assert.equal(stored.ownershipRejected, false)
    assert.equal(stored.verified, true)
    assert.equal(tombstone.cleanupStatus, 'pending')
  })

  test('preserves account backoff when more cleanup work is queued', async () => {
    const nextAttemptAt = new Date(20_000)
    const tombstone = {
      cleanupAttemptCount: 2,
      cleanupLastError: 'temporary outage',
      cleanupNextAttemptAt: nextAttemptAt,
      cleanupStatus: 'pending',
      cleanupUpdatedAt: nextAttemptAt,
    }
    const resource = {}
    const resourceRef = {
      get: async () => ({ exists: false, data: () => ({}) }),
      set: async data => Object.assign(resource, data),
    }
    const tombstoneRef = {
      collection: () => ({ doc: () => resourceRef }),
      get: async () => ({ exists: true, data: () => ({ ...tombstone }) }),
      set: async data => Object.assign(tombstone, data),
    }
    const writes = []
    const timestamp = new Date(10_000)

    await queueBillingCleanup({
      get: ref => ref.get(),
      set: (ref, data) => writes.push(() => ref.set(data)),
    }, tombstoneRef, [{ type: 'customer', stripeId: 'cus_new' }], timestamp)
    for (const write of writes) await write()

    assert.equal(tombstone.cleanupAttemptCount, 2)
    assert.equal(tombstone.cleanupLastError, 'temporary outage')
    assert.equal(tombstone.cleanupNextAttemptAt, nextAttemptAt)
    assert.equal(tombstone.cleanupUpdatedAt, nextAttemptAt)
    assert.equal(resource.status, 'pending')
  })

  test('requires a valid Firebase bearer token', async () => {
    await assert.rejects(authenticate({ verifyIdToken: async () => ({ uid: 'alice' }) }, ''), /required/)
    await assert.rejects(
      authenticate({ verifyIdToken: async () => { throw new Error('expired') } }, 'Bearer expired'),
      error => error.status === 401,
    )
    assert.equal(
      (await authenticate({ verifyIdToken: async () => ({ uid: 'alice' }) }, 'Bearer valid')).uid,
      'alice',
    )
  })

  test('requires authentication within five minutes for destructive actions', async () => {
    const auth = { verifyIdToken: async () => ({ uid: 'alice', auth_time: 1000 }) }
    await assert.doesNotReject(authenticate(auth, 'Bearer valid', {
      maxAgeSeconds: 300,
      nowSeconds: 1300,
    }))
    await assert.rejects(
      authenticate(auth, 'Bearer valid', { maxAgeSeconds: 300, nowSeconds: 1301 }),
      error => error.status === 401 && error.code === 'reauth-required',
    )
    await assert.rejects(
      authenticate({ verifyIdToken: async () => ({ uid: 'alice' }) }, 'Bearer valid', {
        maxAgeSeconds: 300,
        nowSeconds: 1300,
      }),
      error => error.code === 'reauth-required',
    )
  })

  test('redacts capability and provider identifiers from exports', () => {
    assert.deepEqual(safeAccountData({
      location: { city: 'Seattle' },
      calendarFeedToken: 'secret',
      fcmToken: 'secret',
      stripeCheckoutSessionId: 'cs_secret',
      stripeCustomerId: 'cus_secret',
      stripeSubscriptionId: 'sub_secret',
      futureServerSecret: 'secret',
    }), { location: { city: 'Seattle' } })
  })

  test('rejects exports after account deletion starts', async () => {
    let userRead = false
    const userRef = {
      kind: 'user',
      collection: () => ({ kind: 'devices' }),
    }
    const db = {
      collection(name) {
        if (name === 'accountDeletionTombstones') {
          return { doc: () => ({ kind: 'tombstone' }) }
        }
        if (name === 'users') {
          return { doc: () => userRef }
        }
        throw new Error(`Unexpected collection ${name}`)
      },
      async runTransaction(callback) {
        return callback({
          async get(ref) {
            if (ref.kind === 'tombstone') return { exists: true }
            userRead = true
            return ref.kind === 'devices' ? { docs: [] } : { exists: true, data: () => ({}) }
          },
        })
      },
    }

    await assert.rejects(exportAccountData({
      auth: { verifyIdToken: async () => ({ uid: 'alice' }) },
      db,
      req: { headers: { authorization: 'Bearer valid' } },
    }), error => error.status === 409)
    assert.equal(userRead, false)
  })

  test('reads all exported data from one transaction snapshot', async () => {
    const reads = []
    const devicesQuery = { kind: 'devices' }
    const userRef = {
      kind: 'user',
      collection(name) {
        assert.equal(name, 'notificationDevices')
        return devicesQuery
      },
    }
    const tombstoneRef = { kind: 'tombstone' }
    const db = {
      collection(name) {
        if (name === 'accountDeletionTombstones') return { doc: () => tombstoneRef }
        if (name === 'users') return { doc: () => userRef }
        throw new Error(`Unexpected collection ${name}`)
      },
      async runTransaction(callback) {
        return callback({
          async get(ref) {
            reads.push(ref.kind)
            if (ref === tombstoneRef) return { exists: false }
            if (ref === userRef) {
              return { exists: true, data: () => ({ location: { city: 'Seattle' } }) }
            }
            if (ref === devicesQuery) return { docs: [] }
            throw new Error('Unexpected transaction read')
          },
        })
      },
    }

    const result = await exportAccountData({
      auth: { verifyIdToken: async () => ({ uid: 'alice' }) },
      db,
      req: { headers: { authorization: 'Bearer valid' } },
    })

    assert.deepEqual(reads, ['tombstone', 'user', 'devices'])
    assert.deepEqual(result.account, { location: { city: 'Seattle' } })
    assert.deepEqual(result.notificationDevices, [])
  })

  test('quarantines deletion and copies the billing index in bounded pages', async () => {
    const resources = Array.from({ length: 30 }, (_, index) => ({
      id: `resource-${String(index).padStart(2, '0')}`,
      type: 'subscription',
      stripeId: `sub_${index}`,
    }))
    const { db } = fakeDeletionDb({
      resources,
      user: { stripeCheckoutSessionId: 'cs_legacy' },
    })
    const result = await deleteAccount({
      auth: {
        verifyIdToken: async () => ({ uid: 'alice', auth_time: Math.floor(Date.now() / 1000) }),
        revokeRefreshTokens: async uid => db.deleted.push(`sessions:${uid}`),
      },
      db,
      req: { headers: { authorization: 'Bearer valid' }, body: { confirmation: 'DELETE' } },
      stripe: {},
    })
    assert.deepEqual(result, { completed: false, processed: 25 })
    assert.equal(db.userData.accountDeletionStartedAt instanceof Date, true)
    assert.deepEqual(db.deleted, ['sessions:alice'])
    assert.equal(db.tombstoneData.sessionsRevokedAt instanceof Date, true)
    assert.equal(db.tombstoneData.cleanupStatus, 'pending')
    assert.equal(db.tombstoneData.resourceIndexComplete, false)
    assert.equal(db.cleanupResources.size, 26)
    assert.equal(db.subscriptionOwners.size, 25)
    assert.equal(
      [...db.subscriptionOwners.values()].every(resource => resource.uid === 'alice'),
      true,
    )
    assert.equal([...db.cleanupResources.values()].every(resource => resource.status === 'pending'), true)
  })

  test('retains failed Stripe cleanup for retry before final deletion', async () => {
    const { db, tombstoneRef } = fakeDeletionDb({
      resources: [{ id: 'subscription', type: 'subscription', stripeId: 'sub_retry' }],
      tombstone: { cleanupStatus: 'pending', resourceIndexComplete: false },
    })
    const auth = deletionAuth(db)
    const stripe = {
      subscriptions: {
        retrieve: async () => ({ id: 'sub_retry', status: 'active' }),
        cancel: async () => { throw new Error('temporary Stripe failure') },
      },
    }
    await processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: 'alice' })
    await processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: 'alice' })
    let job = [...db.cleanupResources.values()][0]
    assert.equal(job.status, 'pending')
    assert.equal(job.lastError, 'temporary Stripe failure')
    assert.equal(job.attemptCount, 1)
    assert.equal(job.nextAttemptAt.getTime() - job.lastFailedAt.getTime(), 5 * 60 * 1000)

    job.nextAttemptAt = new Date(0)
    await processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: 'alice' })
    job = [...db.cleanupResources.values()][0]
    assert.equal(job.attemptCount, 2)
    assert.equal(job.nextAttemptAt.getTime() - job.lastFailedAt.getTime(), 10 * 60 * 1000)

    stripe.subscriptions.cancel = async id => db.deleted.push(`stripe:${id}`)
    job.nextAttemptAt = new Date(0)
    await processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: 'alice' })
    await processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: 'alice' })
    job = [...db.cleanupResources.values()][0]
    assert.equal(job.status, 'completed')
    assert.deepEqual(
      db.deleted,
      ['sessions:alice', 'stripe:sub_retry', 'limit', 'user', 'auth:alice'],
    )
    assert.equal(db.tombstoneData.cleanupStatus, 'completed')
    assert.deepEqual(
      [...db.subscriptionOwners.values()].map(resource => ({
        stripeId: resource.stripeId,
        uid: resource.uid,
      })),
      [{ stripeId: 'sub_retry', uid: 'alice' }],
    )
  })

  test('moves failed cleanup behind resources that have not been attempted', async () => {
    const attempted = []
    const cleanup = Array.from({ length: 11 }, (_, index) => ({
      id: `subscription-${index}`,
      nextAttemptAt: new Date(0),
      status: 'pending',
      stripeId: `sub_${index}`,
      type: 'subscription',
      verified: true,
    }))
    const { db, tombstoneRef } = fakeDeletionDb({
      cleanup,
      tombstone: { cleanupStatus: 'pending', resourceIndexComplete: true },
    })
    const stripe = {
      subscriptions: {
        retrieve: async id => {
          attempted.push(id)
          throw new Error('temporary Stripe failure')
        },
      },
    }

    const auth = deletionAuth(db)
    await processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: 'alice' })
    await processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: 'alice' })

    assert.deepEqual(attempted.slice(0, 10), cleanup.slice(0, 10).map(resource => resource.stripeId))
    assert.equal(attempted[10], 'sub_10')
  })

  test('does not finalize while another worker holds a resource lease', async () => {
    let releaseRetrieve
    const retrieveStarted = new Promise(resolve => { releaseRetrieve = resolve })
    let continueRetrieve
    const retrieveBlocked = new Promise(resolve => { continueRetrieve = resolve })
    const { db, tombstoneRef } = fakeDeletionDb({
      cleanup: [{
        id: 'subscription',
        nextAttemptAt: new Date(0),
        status: 'pending',
        stripeId: 'sub_leased',
        type: 'subscription',
        verified: true,
      }],
      tombstone: { cleanupStatus: 'pending', resourceIndexComplete: true },
    })
    const stripe = {
      subscriptions: {
        retrieve: async () => {
          releaseRetrieve()
          await retrieveBlocked
          return { id: 'sub_leased', status: 'canceled' }
        },
      },
    }

    const auth = deletionAuth(db)
    const firstWorker = processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: 'alice' })
    await retrieveStarted
    const secondResult = await processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: 'alice' })

    assert.deepEqual(secondResult, { completed: false, processed: 0 })
    assert.deepEqual(db.deleted, ['sessions:alice'])
    continueRetrieve()
    await firstWorker
  })

  test('advances customer checkout and subscription pagination independently', async () => {
    const { db, tombstoneRef } = fakeDeletionDb({
      cleanup: [{
        id: 'customer',
        type: 'customer',
        stripeId: 'cus_pages',
        status: 'pending',
        verified: true,
      }],
      tombstone: { cleanupStatus: 'pending', resourceIndexComplete: true },
    })
    const checkoutRequests = []
    const subscriptionRequests = []
    const stripe = {
      checkout: { sessions: { list: async request => {
        checkoutRequests.push(request)
        return { data: [{ id: `cs_${checkoutRequests.length}` }], has_more: false }
      } } },
      subscriptions: { list: async request => {
        subscriptionRequests.push(request)
        if (subscriptionRequests.length === 1) {
          return { data: [{ id: 'sub_1' }], has_more: true }
        }
        return { data: [{ id: 'sub_2' }], has_more: false }
      } },
    }

    const auth = deletionAuth(db)
    await processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: 'alice' })
    await processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: 'alice' })

    assert.equal(checkoutRequests.length, 1)
    assert.equal(subscriptionRequests.length, 2)
    assert.equal(subscriptionRequests[1].starting_after, 'sub_1')
  })

  test('rescans earlier customer sessions after legacy ownership verification', async () => {
    const { db, tombstoneRef } = fakeDeletionDb({
      cleanup: [{
        id: 'customer',
        type: 'customer',
        stripeId: 'cus_legacy',
        status: 'pending',
        verified: false,
      }],
      tombstone: { cleanupStatus: 'pending', resourceIndexComplete: true },
    })
    const requests = []
    const stripe = {
      checkout: { sessions: { list: async request => {
        requests.push(request)
        if (requests.length === 1) return { data: [{ id: 'cs_early' }], has_more: true }
        if (requests.length === 2) {
          return {
            data: [{ id: 'cs_owned', client_reference_id: 'alice' }],
            has_more: false,
          }
        }
        return { data: [{ id: 'cs_early' }], has_more: false }
      } } },
      subscriptions: { list: async () => ({ data: [], has_more: false }) },
    }

    const auth = deletionAuth(db)
    await processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: 'alice' })
    await processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: 'alice' })
    await processAccountDeletionPage({ auth, db, stripe, tombstoneRef, uid: 'alice' })

    assert.equal(requests[1].starting_after, 'cs_early')
    assert.equal(requests[2].starting_after, undefined)
    assert.equal(
      [...db.cleanupResources.values()].some(resource => resource.stripeId === 'cs_early'),
      true,
    )
  })

  test('schedules the least recently processed deletion tombstones first', async () => {
    const calls = []
    const query = {
      where() { return this },
      orderBy(field) { calls.push(field); return this },
      limit() { return this },
      get: async () => ({ docs: [] }),
    }
    await processPendingAccountDeletions({
      auth: {},
      db: { collection: () => query },
      stripe: {},
    })
    assert.deepEqual(calls, ['cleanupUpdatedAt'])
  })

  test('continues processing deletion tombstones after one account fails', async () => {
    let laterAccountProcessed = false
    const failureUpdates = []
    const brokenState = { cleanupStatus: 'pending' }
    const tombstones = [{
      id: 'broken',
      data: () => ({ ...brokenState }),
      ref: {
        get: async () => { throw new Error('Auth unavailable') },
        state: brokenState,
      },
    }, {
      id: 'later',
      data: () => ({ cleanupStatus: 'pending' }),
      ref: {
        get: async () => {
          laterAccountProcessed = true
          return { exists: true, data: () => ({ cleanupStatus: 'completed' }) }
        },
      },
    }]
    const query = {
      where() { return this },
      orderBy() { return this },
      limit() { return this },
      get: async () => ({ docs: tombstones }),
    }
    const db = {
      collection(name) {
        if (name === 'accountDeletionTombstones') return query
        if (name === 'users') return { doc: () => ({}) }
        throw new Error(`Unexpected collection: ${name}`)
      },
      async runTransaction(callback) {
        return callback({
          get: async ref => ({ exists: true, data: () => ({ ...ref.state }) }),
          set: (ref, data, options) => {
            Object.assign(ref.state, data)
            failureUpdates.push({ data, options })
          },
        })
      },
    }

    await assert.rejects(
      processPendingAccountDeletions({ auth: {}, db, stripe: {} }),
      error => error instanceof AggregateError
        && error.errors.length === 1
        && error.errors[0].cause.message === 'Auth unavailable',
    )
    assert.equal(laterAccountProcessed, true)
    assert.equal(failureUpdates.length, 1)
    assert.equal(failureUpdates[0].data.cleanupLastError, 'Auth unavailable')
    assert.equal(failureUpdates[0].data.cleanupAttemptCount, 1)
    assert.equal(
      failureUpdates[0].data.cleanupNextAttemptAt.getTime()
        - failureUpdates[0].data.cleanupLastFailedAt.getTime(),
      5 * 60 * 1000,
    )
    assert.equal(
      failureUpdates[0].data.cleanupUpdatedAt,
      failureUpdates[0].data.cleanupNextAttemptAt,
    )
    assert.deepEqual(failureUpdates[0].options, { merge: true })
  })

  test('skips account cleanup until its retry is due', async () => {
    let deferredReads = 0
    let dueReads = 0
    const tombstones = [{
      id: 'deferred',
      data: () => ({
        cleanupNextAttemptAt: new Date(20_000),
        cleanupStatus: 'pending',
      }),
      ref: { get: async () => { deferredReads += 1 } },
    }, {
      id: 'due',
      data: () => ({
        cleanupNextAttemptAt: new Date(9_000),
        cleanupStatus: 'pending',
      }),
      ref: {
        get: async () => {
          dueReads += 1
          return { exists: true, data: () => ({ cleanupStatus: 'completed' }) }
        },
      },
    }]
    const query = {
      where() { return this },
      orderBy() { return this },
      limit() { return this },
      get: async () => ({ docs: tombstones }),
    }
    const db = {
      collection(name) {
        if (name === 'accountDeletionTombstones') return query
        if (name === 'users') return { doc: () => ({}) }
        throw new Error(`Unexpected collection: ${name}`)
      },
    }

    const results = await processPendingAccountDeletions({
      auth: {},
      db,
      now: new Date(10_000),
      stripe: {},
    })

    assert.equal(deferredReads, 0)
    assert.equal(dueReads, 1)
    assert.deepEqual(results, [{ completed: true, processed: 0 }])
  })

  test('caps account cleanup retry delays', async () => {
    const state = { cleanupAttemptCount: 40, cleanupStatus: 'pending' }
    const tombstone = {
      id: 'broken',
      data: () => ({ ...state }),
      ref: {
        get: async () => { throw new Error('persistent failure') },
        state,
      },
    }
    const query = {
      where() { return this },
      orderBy() { return this },
      limit() { return this },
      get: async () => ({ docs: [tombstone] }),
    }
    const db = {
      collection(name) {
        if (name === 'accountDeletionTombstones') return query
        if (name === 'users') return { doc: () => ({}) }
        throw new Error(`Unexpected collection: ${name}`)
      },
      async runTransaction(callback) {
        return callback({
          get: async ref => ({ exists: true, data: () => ({ ...ref.state }) }),
          set: (ref, data) => Object.assign(ref.state, data),
        })
      },
    }

    await assert.rejects(
      processPendingAccountDeletions({ auth: {}, db, stripe: {} }),
      error => error instanceof AggregateError,
    )

    assert.equal(state.cleanupAttemptCount, 41)
    assert.equal(
      state.cleanupNextAttemptAt.getTime() - state.cleanupLastFailedAt.getTime(),
      24 * 60 * 60 * 1000,
    )
  })
})

describe('browser API CORS', () => {
  test('allows preflight only from the configured app origin', () => {
    const allowed = responseRecorder()
    assert.equal(handleCors(
      {
        method: 'OPTIONS',
        headers: {
          origin: 'https://app.example.com',
          'access-control-request-headers': 'authorization,content-type,x-firebase-appcheck',
        },
      },
      allowed,
      'https://app.example.com',
      ['POST'],
    ), true)
    assert.equal(allowed.statusCode, 204)
    assert.equal(allowed.headers['Access-Control-Allow-Origin'], 'https://app.example.com')
    assert.equal(
      allowed.headers['Access-Control-Allow-Headers'],
      'Authorization, Content-Type, X-Firebase-AppCheck',
    )
    assert.equal(allowed.headers['Access-Control-Allow-Methods'], 'POST')

    const denied = responseRecorder()
    assert.equal(handleCors(
      { method: 'OPTIONS', headers: { origin: 'https://attacker.example' } },
      denied,
      'https://app.example.com',
      ['POST'],
    ), true)
    assert.equal(denied.statusCode, 403)
    assert.equal(denied.headers['Access-Control-Allow-Origin'], undefined)
  })

  test('permits a normal request from the configured app origin', () => {
    const res = responseRecorder()
    assert.equal(handleCors(
      { method: 'POST', headers: { origin: 'https://app.example.com' } },
      res,
      'https://app.example.com',
      ['POST'],
    ), false)
    assert.equal(res.headers.Vary, 'Origin')
  })
})

describe('calendar feed security', () => {
  test('accepts only fixed-format URL-safe secrets and valid coordinates', () => {
    assert.equal(validFeedToken('A'.repeat(32)), true)
    assert.equal(validFeedToken('A'.repeat(31)), false)
    assert.equal(validFeedToken(`${'A'.repeat(31)}!`), false)
    assert.equal(validCoordinates({ lat: 90, lon: -180 }), true)
    assert.equal(validCoordinates({ lat: 91, lon: 0 }), false)
  })

  test('caches identical rounded-location forecast requests', async () => {
    let calls = 0
    const fetcher = async () => { calls += 1; return [{ dateStr: '2026-07-14' }] }
    await cachedForecast(fetcher, { lat: 47.611, lon: -122.331 }, 7, 1000)
    await cachedForecast(fetcher, { lat: 47.612, lon: -122.332 }, 7, 1001)
    assert.equal(calls, 1)
  })

  test('returns a private feed with defensive headers', async () => {
    const handler = createCalendarFeedHandler({
      buildICS: events => `calendar:${events.length}`,
      buildSunEvents: () => [{ id: 1 }],
      db: { collection: () => queryWith({ data: () => ({ location: { lat: 1, lon: 2 } }) }) },
      days: 7,
      fetchForecast: async () => [],
    })
    const res = responseRecorder()
    await handler({ method: 'GET', query: { token: 'A'.repeat(32) } }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body, 'calendar:1')
    assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0')
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
    assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow, noarchive')
  })

  test('rejects a feed after account deletion starts', async () => {
    const handler = createCalendarFeedHandler({
      buildICS: () => { throw new Error('must not build') },
      buildSunEvents: () => { throw new Error('must not build') },
      db: { collection: () => queryWith({ data: () => ({ accountDeletionStartedAt: new Date() }) }) },
      days: 7,
      fetchForecast: async () => { throw new Error('must not fetch') },
    })
    const res = responseRecorder()
    await handler({ method: 'GET', query: { token: 'A'.repeat(32) } }, res)
    assert.equal(res.statusCode, 404)
    assert.equal(res.body, 'Unknown feed')
  })

  test('rejects unsupported methods before querying Firestore', async () => {
    const handler = createCalendarFeedHandler({
      buildICS: () => '',
      buildSunEvents: () => [],
      db: { collection: () => { throw new Error('must not query') } },
      days: 7,
      fetchForecast: async () => [],
    })
    const res = responseRecorder()
    await handler({ method: 'POST', query: {} }, res)
    assert.equal(res.statusCode, 405)
    assert.equal(res.headers.Allow, 'GET, HEAD')
  })
})

describe('Stripe fulfillment security', () => {
  const session = {
    id: 'cs_123',
    mode: 'subscription',
    payment_status: 'paid',
    client_reference_id: 'alice',
    metadata: { firebaseUid: 'alice' },
    customer: 'cus_123',
    subscription: 'sub_123',
  }
  const stripe = {
    checkout: {
      sessions: {
        list: async () => ({ data: [session], has_more: false }),
        listLineItems: async () => ({ data: [{ price: { id: 'price_pro' } }] }),
      },
    },
    subscriptions: {
      retrieve: async id => ({
        id,
        customer: 'cus_123',
        status: 'active',
        items: { data: [{ price: { id: 'price_pro' } }] },
      }),
    },
  }

  test('backfills legacy checkout ownership across durable pages', async () => {
    const subscriptionOwners = new Map()
    const state = {}
    const userRef = withBillingResources({
      id: 'alice',
      async get() { return { exists: true, data: () => ({ tier: 'paid' }) } },
    })
    const stateRef = {
      async get() { return { exists: Object.keys(state).length > 0, data: () => ({ ...state }) } },
      async set(data) { Object.assign(state, data) },
    }
    const db = {
      collection(name) {
        if (name === 'users') return { doc: () => userRef }
        if (name === 'stripeSubscriptionOwners') {
          return { doc: id => ({ id, kind: 'subscriptionOwner' }) }
        }
        if (name === 'accountDeletionTombstones') {
          return { doc: () => ({ get: async () => ({ exists: false }) }) }
        }
        if (name === 'systemMigrations') return { doc: () => stateRef }
        throw new Error(`Unexpected collection ${name}`)
      },
      async runTransaction(callback) {
        const writes = []
        const result = await callback({
          get: ref => ref.get(),
          set: (ref, data) => writes.push(() => {
            if (ref.kind === 'subscriptionOwner') {
              subscriptionOwners.set(ref.id, data)
            } else {
              userRef.billingResources.set(ref.id, data)
            }
          }),
        })
        writes.forEach(write => write())
        return result
      },
    }
    const pages = [
      {
        data: [{
          id: 'cs_legacy_a',
          client_reference_id: 'alice',
          customer: 'cus_legacy_a',
          subscription: 'sub_legacy_a',
        }],
        has_more: true,
      },
      {
        data: [{
          id: 'cs_legacy_b',
          client_reference_id: 'alice',
          customer: 'cus_legacy_b',
          subscription: 'sub_legacy_b',
        }],
        has_more: false,
      },
      {
        data: [{
          id: 'cs_legacy_a',
          client_reference_id: 'alice',
          customer: 'cus_legacy_a',
          subscription: 'sub_legacy_a',
        }],
        has_more: true,
      },
      {
        data: [{
          id: 'cs_legacy_b',
          client_reference_id: 'alice',
          customer: 'cus_legacy_b',
          subscription: 'sub_legacy_b',
        }],
        has_more: false,
      },
    ]
    const stripeClient = { checkout: { sessions: { list: async params => {
      if (params.starting_after) assert.equal(params.starting_after, 'cs_legacy_a')
      return pages.shift()
    } } } }

    assert.deepEqual(await backfillBillingResourcePage({
      db,
      serverTimestamp: () => 'SERVER_TIME',
      stripe: stripeClient,
    }), { completed: false, processed: 1 })
    assert.deepEqual(await backfillBillingResourcePage({
      db,
      serverTimestamp: () => 'SERVER_TIME',
      stripe: stripeClient,
    }), { completed: false, processed: 1 })
    assert.deepEqual(await backfillBillingResourcePage({
      db,
      serverTimestamp: () => 'SERVER_TIME',
      stripe: stripeClient,
    }), { completed: false, processed: 1 })
    assert.deepEqual(await backfillBillingResourcePage({
      db,
      serverTimestamp: () => 'SERVER_TIME',
      stripe: stripeClient,
    }), { completed: true, processed: 1 })
    assert.deepEqual(
      [...userRef.billingResources.values()]
        .map(resource => `${resource.type}:${resource.stripeId}`).sort(),
      [
        'checkoutSession:cs_legacy_a',
        'checkoutSession:cs_legacy_b',
        'customer:cus_legacy_a',
        'customer:cus_legacy_b',
        'subscription:sub_legacy_a',
        'subscription:sub_legacy_b',
      ],
    )
    assert.deepEqual(
      [...subscriptionOwners.values()]
        .map(resource => `${resource.stripeId}:${resource.uid}`).sort(),
      ['sub_legacy_a:alice', 'sub_legacy_b:alice'],
    )
  })

  test('routes tombstoned legacy checkout resources into durable cleanup', async () => {
    const subscriptionOwners = new Map()
    const cleanup = new Map()
    const state = {}
    const tombstone = { cleanupStatus: 'pending', resourceIndexComplete: true }
    const tombstoneRef = {
      async get() { return { exists: true, data: () => ({ ...tombstone }) } },
      async set(data) { Object.assign(tombstone, data) },
      collection(name) {
        assert.equal(name, 'billingCleanupResources')
        return { doc: id => ({
          id,
          async get() {
            const data = cleanup.get(id)
            return { exists: !!data, data: () => ({ ...data }) }
          },
          async set(data) { cleanup.set(id, { ...cleanup.get(id), ...data }) },
        }) }
      },
    }
    const stateRef = {
      async get() { return { exists: Object.keys(state).length > 0, data: () => ({ ...state }) } },
      async set(data) { Object.assign(state, data) },
    }
    const db = {
      collection(name) {
        if (name === 'users') return { doc: () => ({ get: async () => ({ exists: false }) }) }
        if (name === 'stripeSubscriptionOwners') {
          return { doc: id => ({
            async set(data) {
              subscriptionOwners.set(id, { ...subscriptionOwners.get(id), ...data })
            },
          }) }
        }
        if (name === 'accountDeletionTombstones') return { doc: () => tombstoneRef }
        if (name === 'systemMigrations') return { doc: () => stateRef }
        throw new Error(`Unexpected collection ${name}`)
      },
      async runTransaction(callback) {
        const writes = []
        const result = await callback({
          get: ref => ref.get(),
          set: (ref, data) => writes.push(() => ref.set(data)),
        })
        for (const write of writes) await write()
        return result
      },
    }
    const stripeClient = { checkout: { sessions: { list: async () => ({
      data: [{
        id: 'cs_deleted',
        client_reference_id: 'alice',
        customer: 'cus_deleted',
        subscription: 'sub_deleted',
      }],
      has_more: false,
    }) } } }

    assert.deepEqual(await backfillBillingResourcePage({
      db,
      serverTimestamp: () => 'SERVER_TIME',
      stripe: stripeClient,
    }), { completed: false, processed: 0 })
    assert.deepEqual(
      [...cleanup.values()].map(resource => `${resource.type}:${resource.stripeId}`).sort(),
      [
        'checkoutSession:cs_deleted',
        'customer:cus_deleted',
        'subscription:sub_deleted',
      ],
    )
    assert.equal(tombstone.cleanupStatus, 'pending')
    assert.deepEqual(
      [...subscriptionOwners.values()]
        .map(resource => `${resource.stripeId}:${resource.uid}`).sort(),
      ['sub_deleted:alice'],
    )
  })

  test('validates Firebase identifiers and configured Stripe products', async () => {
    assert.equal(validUid('firebase_User-1'), true)
    assert.equal(validUid('../users/admin'), false)
    assert.equal(validAttemptId('12345678-1234-1234-1234-123456789abc'), true)
    assert.equal(validAttemptId('short'), false)
    await assert.doesNotReject(validateCheckoutSession(stripe, session, 'price_pro'))
    await assert.doesNotReject(validateCheckoutSession(
      stripe,
      { ...session, metadata: {} },
      'price_pro',
    ))
    await assert.rejects(
      validateCheckoutSession(stripe, { ...session, metadata: { firebaseUid: 'mallory' } }, 'price_pro'),
      /not bound/,
    )
    await assert.rejects(validateCheckoutSession(stripe, session, 'price_other'), /configured price/)
  })

  test('recognizes only the configured subscription price', () => {
    const subscription = { items: { data: [{ price: { id: 'price_pro' } }] } }
    assert.equal(subscriptionHasPrice(subscription, 'price_pro'), true)
    assert.equal(subscriptionHasPrice(subscription, 'price_other'), false)
    assert.equal(subscriptionHasPrice(subscription, ''), false)
  })

  test('creates checkout from verified identity rather than request body identity', async () => {
    let params
    let requestOptions
    const checkout = await createCheckout({
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice', email: 'alice@example.com' }) },
      db: fakeDb({ tier: 'free' }),
      expectedPriceId: 'price_pro',
      req: { headers: { authorization: 'Bearer valid-token' }, body: { uid: 'mallory', attemptId: '12345678-1234-1234-1234-123456789abc' } },
      stripe: { checkout: { sessions: { create: async (value, options) => {
        params = value
        requestOptions = options
        return { url: 'https://checkout.stripe.com/session' }
      } } } },
    })
    assert.equal(checkout.url, 'https://checkout.stripe.com/session')
    assert.equal(params.client_reference_id, 'alice')
    assert.deepEqual(params.metadata, { firebaseUid: 'alice' })
    assert.equal(params.line_items[0].price, 'price_pro')
    assert.match(requestOptions.idempotencyKey, /^checkout:[a-f0-9]{64}$/)
  })

  test('creates a billing portal only for the authenticated customer', async () => {
    let params
    const session = await createBillingPortal({
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice' }) },
      db: fakeDb({ stripeCustomerId: 'cus_123' }),
      req: { headers: { authorization: 'Bearer valid-token' }, body: { attemptId: '12345678-1234-1234-1234-123456789abc' } },
      stripe: {
        billingPortal: { sessions: { create: async value => { params = value; return { url: 'https://billing.stripe.com/session/test' } } } },
        checkout: { sessions: { list: async () => ({
          data: [{ id: 'cs_legacy', client_reference_id: 'alice' }],
          has_more: false,
        }) } },
      },
    })
    assert.equal(session.url, 'https://billing.stripe.com/session/test')
    assert.deepEqual(params, { customer: 'cus_123', return_url: 'https://example.com/account/' })
    await assert.rejects(createBillingPortal({
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice' }) },
      db: fakeDb({ tier: 'free' }),
      req: { headers: { authorization: 'Bearer valid-token' } },
      stripe: { billingPortal: { sessions: { create: async () => ({}) } } },
    }), error => error.status === 404)
  })

  test('rejects a billing customer that is not verified for the authenticated account', async () => {
    await assert.rejects(createBillingPortal({
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice' }) },
      db: fakeDb({ stripeCustomerId: 'cus_victim' }),
      req: { headers: { authorization: 'Bearer valid-token' } },
      stripe: {
        billingPortal: { sessions: { create: async () => ({}) } },
        checkout: { sessions: { list: async () => ({
          data: [{ id: 'cs_victim', client_reference_id: 'victim' }],
          has_more: false,
        }) } },
      },
    }), error => error.status === 404)
  })

  test('rejects checkout reuse of an unverified legacy customer', async () => {
    let created = false
    await assert.rejects(createCheckout({
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice', email: 'alice@example.com' }) },
      db: fakeDb({
        stripeCustomerId: 'cus_victim',
        stripeSubscriptionId: 'sub_old',
        subscriptionStatus: 'canceled',
      }),
      expectedPriceId: 'price_pro',
      req: { headers: { authorization: 'Bearer valid-token' }, body: { attemptId: '12345678-1234-1234-1234-123456789abc' } },
      stripe: {
        checkout: { sessions: {
          create: async () => { created = true },
          list: async () => ({
            data: [{ id: 'cs_victim', client_reference_id: 'victim' }],
            has_more: false,
          }),
        } },
        subscriptions: { list: async () => { throw new Error('must not list victim subscriptions') } },
      },
    }), error => error.status === 409)
    assert.equal(created, false)
  })

  test('prevents duplicate subscriptions and reuses known Stripe customers', async () => {
    const options = {
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice', email: 'alice@example.com' }) },
      expectedPriceId: 'price_pro',
      req: { headers: { authorization: 'Bearer valid-token' }, body: { attemptId: '12345678-1234-1234-1234-123456789abc' } },
      stripe: {
        checkout: { sessions: {
          create: async params => params,
          list: async () => ({ data: [session], has_more: false }),
        } },
        subscriptions: { list: async () => ({ data: [], has_more: false }) },
      },
    }
    await assert.rejects(
      createCheckout({
        ...options,
        db: fakeDb({ stripeSubscriptionId: 'sub_active', subscriptionStatus: 'active' }),
      }),
      error => error.status === 409,
    )

    const checkout = await createCheckout({
      ...options,
      db: fakeDb({
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_canceled',
        subscriptionStatus: 'canceled',
      }),
    })
    assert.equal(checkout.customer, 'cus_123')
    assert.equal(checkout.customer_email, undefined)
  })

  test('blocks concurrent checkout attempts before either webhook arrives', async () => {
    const db = fakeDb({ tier: 'free' })
    let finishFirst
    const firstCreated = new Promise(resolve => { finishFirst = resolve })
    let creationStarted
    const started = new Promise(resolve => { creationStarted = resolve })
    const options = {
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice', email: 'alice@example.com' }) },
      db,
      expectedPriceId: 'price_pro',
      stripe: { checkout: { sessions: { create: async () => {
        creationStarted()
        await firstCreated
        return { id: 'cs_first', url: 'https://checkout.stripe.com/first' }
      } } } },
    }
    const first = createCheckout({
      ...options,
      req: { headers: { authorization: 'Bearer valid-token' }, body: { attemptId: '12345678-1234-1234-1234-123456789abc' } },
    })
    await started
    await assert.rejects(createCheckout({
      ...options,
      req: { headers: { authorization: 'Bearer valid-token' }, body: { attemptId: 'abcdefab-1234-1234-1234-123456789abc' } },
    }), error => error.status === 409)
    finishFirst()
    await first
  })

  test('reuses an open pending checkout after a canceled browser return', async () => {
    let created = false
    const existing = {
      id: 'cs_existing',
      status: 'open',
      url: 'https://checkout.stripe.com/existing',
      client_reference_id: 'alice',
    }
    const checkout = await createCheckout({
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice', email: 'alice@example.com' }) },
      db: fakeDb({
        tier: 'free',
        stripeCheckoutAttemptId: '12345678-1234-1234-1234-123456789abc',
        stripeCheckoutSessionId: existing.id,
        stripeCheckoutStatus: 'pending',
        stripeCheckoutReservedUntil: new Date(Date.now() + 60_000),
      }),
      expectedPriceId: 'price_pro',
      req: { headers: { authorization: 'Bearer valid-token' }, body: { attemptId: 'abcdefab-1234-1234-1234-123456789abc' } },
      stripe: { checkout: { sessions: {
        retrieve: async id => { assert.equal(id, existing.id); return existing },
        create: async () => { created = true },
      } } },
    })
    assert.equal(checkout, existing)
    assert.equal(created, false)
  })

  test('does not reuse a pending checkout owned by another account', async () => {
    const checkout = await createCheckout({
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice', email: 'alice@example.com' }) },
      db: fakeDb({
        tier: 'free',
        stripeCheckoutSessionId: 'cs_foreign',
        stripeCheckoutStatus: 'pending',
      }),
      expectedPriceId: 'price_pro',
      req: { headers: { authorization: 'Bearer valid-token' }, body: { attemptId: 'abcdefab-1234-1234-1234-123456789abc' } },
      stripe: { checkout: { sessions: {
        retrieve: async () => ({
          id: 'cs_foreign',
          status: 'open',
          url: 'https://checkout.stripe.com/foreign',
          client_reference_id: 'mallory',
        }),
        create: async () => ({
          id: 'cs_alice',
          status: 'open',
          url: 'https://checkout.stripe.com/alice',
        }),
      } } },
    })
    assert.equal(checkout.id, 'cs_alice')
  })

  test('rejects checkout when account deletion has started', async () => {
    let created = false
    await assert.rejects(createCheckout({
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice', email: 'alice@example.com' }) },
      db: fakeDb({ tier: 'free', accountDeletionStartedAt: new Date() }),
      expectedPriceId: 'price_pro',
      req: { headers: { authorization: 'Bearer valid-token' }, body: { attemptId: '12345678-1234-1234-1234-123456789abc' } },
      stripe: { checkout: { sessions: { create: async () => { created = true } } } },
    }), error => error.status === 409)
    assert.equal(created, false)
  })

  test('durably queues a checkout racing account deletion before Stripe cleanup', async () => {
    const db = fakeDb({ tier: 'free' })
    await assert.rejects(createCheckout({
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice', email: 'alice@example.com' }) },
      db,
      expectedPriceId: 'price_pro',
      req: { headers: { authorization: 'Bearer valid-token' }, body: { attemptId: '12345678-1234-1234-1234-123456789abc' } },
      stripe: { checkout: { sessions: {
        create: async () => {
          db.userData.accountDeletionStartedAt = new Date()
          return { id: 'cs_raced', status: 'open', url: 'https://checkout.stripe.com/raced' }
        },
        retrieve: async () => ({ id: 'cs_raced', status: 'open' }),
        expire: async () => { throw new Error('temporary Stripe failure') },
      } } },
    }), /temporary Stripe failure/)
    assert.deepEqual(
      [...db.cleanupResources.values()].map(resource => `${resource.type}:${resource.stripeId}`),
      ['checkoutSession:cs_raced'],
    )
  })

  test('rejects a legacy customer with a live Stripe subscription', async () => {
    let created = false
    await assert.rejects(createCheckout({
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice', email: 'alice@example.com' }) },
      db: fakeDb({ stripeCustomerId: 'cus_legacy', tier: 'free' }),
      expectedPriceId: 'price_pro',
      req: { headers: { authorization: 'Bearer valid-token' }, body: { attemptId: '12345678-1234-1234-1234-123456789abc' } },
      stripe: {
        checkout: { sessions: {
          create: async () => { created = true },
          list: async () => ({ data: [session], has_more: false }),
        } },
        subscriptions: { list: async () => ({
          data: [{ id: 'sub_legacy', status: 'past_due' }],
          has_more: false,
        }) },
      },
    }), error => error.status === 409)
    assert.equal(created, false)
  })

  test('grants paid tier once for a valid completed checkout event', async () => {
    const db = fakeDb({ tier: 'free' })
    const event = { id: 'evt_1', created: 100, type: 'checkout.session.completed', data: { object: session } }
    const options = {
      db,
      event,
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe,
    }

    const first = await processStripeEvent(options)
    const second = await processStripeEvent(options)
    assert.equal(first.duplicate, false)
    assert.equal(second.duplicate, true)
    assert.equal(db.userData.tier, 'paid')
    assert.equal(db.userData.stripeSubscriptionId, 'sub_123')
    assert.equal(db.userData.subscriptionStatus, 'active')
    assert.deepEqual(
      [...db.collection('users').doc('alice').billingResources.values()]
        .map(resource => `${resource.type}:${resource.stripeId}`).sort(),
      ['checkoutSession:cs_123', 'customer:cus_123', 'subscription:sub_123'],
    )
    assert.deepEqual(
      [...db.subscriptionOwners.values()]
        .map(resource => `${resource.stripeId}:${resource.uid}`).sort(),
      ['sub_123:alice'],
    )
  })

  test('cancels a checkout subscription when its account was deleted', async () => {
    const canceled = []
    const db = fakeDb(null)
    const deletedAccountStripe = {
      ...stripe,
      subscriptions: {
        ...stripe.subscriptions,
        cancel: async id => canceled.push(id),
      },
    }
    const result = await processStripeEvent({
      db,
      event: { id: 'evt_deleted', created: 100, type: 'checkout.session.completed', data: { object: session } },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe: deletedAccountStripe,
    })
    assert.equal(result.accountDeleted, true)
    assert.deepEqual(canceled, ['sub_123'])
    await processStripeEvent({
      db,
      event: { id: 'evt_deleted', created: 100, type: 'checkout.session.completed', data: { object: session } },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe: deletedAccountStripe,
    })
    assert.deepEqual(canceled, ['sub_123'])
  })

  test('cancels a losing concurrent checkout subscription', async () => {
    const canceled = []
    const db = fakeDb({
      tier: 'paid',
      stripeSubscriptionId: 'sub_winner',
      subscriptionStatus: 'active',
    })
    const result = await processStripeEvent({
      db,
      event: { id: 'evt_loser', created: 100, type: 'checkout.session.completed', data: { object: session } },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe: {
        ...stripe,
        subscriptions: { ...stripe.subscriptions, cancel: async id => canceled.push(id) },
      },
    })
    assert.equal(result.rejected, true)
    assert.equal(db.userData.stripeSubscriptionId, 'sub_winner')
    assert.deepEqual(canceled, ['sub_123'])
  })

  test('cancels a stale losing checkout independently of event freshness', async () => {
    const canceled = []
    const db = fakeDb({
      tier: 'paid',
      stripeSubscriptionId: 'sub_winner',
      subscriptionStatus: 'active',
      stripeEventCreated: 200,
      stripeEventPriority: 4,
    })
    const result = await processStripeEvent({
      db,
      event: { id: 'evt_stale_loser', created: 100, type: 'checkout.session.completed', data: { object: session } },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe: {
        ...stripe,
        subscriptions: { ...stripe.subscriptions, cancel: async id => canceled.push(id) },
      },
    })
    assert.equal(result.rejected, true)
    assert.deepEqual(canceled, ['sub_123'])
  })

  test('retries a durable losing-subscription cancellation after failure', async () => {
    const attemptedIds = []
    const db = fakeDb({
      tier: 'paid',
      stripeSubscriptionId: 'sub_winner',
      subscriptionStatus: 'active',
    })
    const options = {
      db,
      event: { id: 'evt_retry_loser', created: 100, type: 'checkout.session.completed', data: { object: session } },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe: {
        ...stripe,
        subscriptions: {
          ...stripe.subscriptions,
          cancel: async id => {
            attemptedIds.push(id)
            if (attemptedIds.length === 1) throw new Error('temporary Stripe outage')
          },
        },
      },
    }
    await assert.rejects(processStripeEvent(options), /temporary Stripe outage/)
    db.userData.subscriptionStatus = 'canceled'
    options.event.data.object = { ...options.event.data.object, subscription: 'sub_changed' }
    const retry = await processStripeEvent(options)
    assert.equal(retry.duplicate, true)
    assert.deepEqual(attemptedIds, ['sub_123', 'sub_123'])
  })

  test('waits for asynchronous checkout payment before granting paid access', async () => {
    const db = fakeDb({ tier: 'free' })
    const unpaidSession = { ...session, payment_status: 'unpaid' }
    const completed = await processStripeEvent({
      db,
      event: {
        id: 'evt_async_completed',
        created: 100,
        type: 'checkout.session.completed',
        data: { object: unpaidSession },
      },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe,
    })
    assert.equal(completed.applied, true)
    assert.equal(db.userData.tier, 'free')
    assert.equal(db.userData.stripeCustomerId, 'cus_123')
    assert.equal(db.userData.stripeSubscriptionId, 'sub_123')
    assert.equal(db.userData.stripeCheckoutStatus, 'pending')

    await assert.rejects(createCheckout({
      appUrl: 'https://example.com',
      auth: { verifyIdToken: async () => ({ uid: 'alice', email: 'alice@example.com' }) },
      db,
      expectedPriceId: 'price_pro',
      req: { headers: { authorization: 'Bearer valid-token' }, body: { attemptId: '12345678-1234-1234-1234-123456789abc' } },
      stripe: {
        checkout: { sessions: { create: async params => params } },
        subscriptions: { list: async () => ({ data: [], has_more: false }) },
      },
    }), error => error.status === 409)

    await processStripeEvent({
      db,
      event: {
        id: 'evt_async_succeeded',
        created: 101,
        type: 'checkout.session.async_payment_succeeded',
        data: { object: session },
      },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe,
    })
    assert.equal(db.userData.tier, 'paid')
    assert.equal(db.userData.stripeSubscriptionId, 'sub_123')
    assert.equal(db.userData.stripeCheckoutStatus, 'succeeded')
  })

  test('records asynchronous checkout payment failure without granting access', async () => {
    const db = fakeDb({ tier: 'free' })
    const options = {
      db,
      event: {
        id: 'evt_async_failed',
        created: 100,
        type: 'checkout.session.async_payment_failed',
        data: { object: { ...session, payment_status: 'unpaid' } },
      },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe,
    }
    const first = await processStripeEvent(options)
    const second = await processStripeEvent(options)
    assert.equal(first.applied, true)
    assert.equal(second.duplicate, true)
    assert.equal(db.userData.tier, 'free')
    assert.equal(db.userData.stripeSubscriptionId, 'sub_123')
    assert.equal(db.userData.stripeCheckoutStatus, 'failed')
  })

  test('keeps asynchronous success when failure shares its event timestamp', async () => {
    const db = fakeDb({ tier: 'free' })
    await processStripeEvent({
      db,
      event: { id: 'evt_success_tie', created: 100, type: 'checkout.session.async_payment_succeeded', data: { object: session } },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe,
    })
    const failure = await processStripeEvent({
      db,
      event: {
        id: 'evt_failure_tie',
        created: 100,
        type: 'checkout.session.async_payment_failed',
        data: { object: { ...session, payment_status: 'unpaid' } },
      },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe,
    })
    assert.equal(failure.applied, false)
    assert.equal(db.userData.tier, 'paid')
    assert.equal(db.userData.stripeCheckoutStatus, 'succeeded')
  })

  test('revokes access when the configured subscription ends', async () => {
    const db = fakeDb({
      tier: 'paid',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
    })
    const event = {
      id: 'evt_2',
      created: 200,
      type: 'customer.subscription.deleted',
      data: { object: {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'canceled',
        items: { data: [{ price: { id: 'price_pro' } }] },
      } },
    }
    await processStripeEvent({
      db,
      event,
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe,
    })
    assert.equal(db.userData.tier, 'free')
    assert.equal(db.userData.subscriptionStatus, 'canceled')
    assert.equal(db.userData.proSince, null)
  })

  test('revokes access when an owned subscription removes the configured price', async () => {
    const db = fakeDb({
      tier: 'paid',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      subscriptionStatus: 'active',
    })
    const wrongPriceStripe = {
      checkout: stripe.checkout,
      subscriptions: {
        retrieve: async () => ({
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          items: { data: [{ price: { id: 'price_other' } }] },
        }),
      },
    }
    await processStripeEvent({
      db,
      event: {
        id: 'evt_wrong_price',
        created: 201,
        type: 'customer.subscription.updated',
        data: { object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          items: { data: [{ price: { id: 'price_other' } }] },
        } },
      },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe: wrongPriceStripe,
    })

    assert.equal(db.userData.tier, 'free')
    assert.equal(db.userData.subscriptionStatus, 'active')
    assert.equal(db.userData.proSince, null)
  })

  test('does not restore access from an older or lower-priority event', async () => {
    const db = fakeDb({
      tier: 'free',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      subscriptionStatus: 'canceled',
      stripeEventCreated: 200,
      stripeEventPriority: 2,
    })
    const event = {
      id: 'evt_old',
      created: 199,
      type: 'customer.subscription.updated',
      data: { object: {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        items: { data: [{ price: { id: 'price_pro' } }] },
      } },
    }
    const result = await processStripeEvent({
      db,
      event,
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe,
    })
    assert.equal(result.applied, false)
    assert.equal(db.userData.tier, 'free')
    assert.equal(db.userData.subscriptionStatus, 'canceled')
  })

  test('acknowledges deletion events after their account is gone', async () => {
    const db = fakeDb(null)
    const result = await processStripeEvent({
      db,
      event: {
        id: 'evt_deleted_account',
        created: 300,
        type: 'customer.subscription.deleted',
        data: { object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'canceled',
          items: { data: [{ price: { id: 'price_pro' } }] },
        } },
      },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe,
    })
    assert.equal(result.duplicate, false)
  })

  test('cancels metadata-free delayed subscription updates for tombstoned accounts', async () => {
    const db = fakeDb(null)
    db.tombstoneData.cleanupStatus = 'completed'
    db.subscriptionOwners.set(
      subscriptionOwnerRef(
        { collection: () => ({ doc: id => ({ id }) }) },
        'sub_deleted',
      ).id,
      { stripeId: 'sub_deleted', uid: 'alice' },
    )
    const canceled = []
    const deletedSubscription = {
      id: 'sub_deleted',
      customer: 'cus_deleted',
      status: 'active',
      metadata: {},
      items: { data: [{ price: { id: 'price_pro' } }] },
    }
    const result = await processStripeEvent({
      db,
      event: {
        id: 'evt_delayed_update',
        created: 301,
        type: 'customer.subscription.updated',
        data: { object: deletedSubscription },
      },
      expectedPriceId: 'price_pro',
      serverTimestamp: () => 'SERVER_TIME',
      stripe: {
        checkout: stripe.checkout,
        subscriptions: {
          retrieve: async () => deletedSubscription,
          cancel: async id => { canceled.push(id) },
        },
      },
    })

    assert.equal(result.accountDeleted, true)
    assert.deepEqual(canceled, ['sub_deleted'])
  })
})
