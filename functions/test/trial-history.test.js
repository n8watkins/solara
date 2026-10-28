// The trial history's keys without Firestore: the same person gives the same keys from
// an ID token (checkout) and from the Auth user record (webhook), and nothing readable.
// The records themselves are tested in test/emulator/lifecycle.test.js.
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const {
  TrialHistory,
  identityFromToken,
  identityFromUser,
} = require('../lib/billing/trial-history')

const history = new TrialHistory({}, 'unit-test-key')

const token = {
  uid: 'uid-1',
  email: 'Ann@Example.com',
  email_verified: true,
  firebase: {
    sign_in_provider: 'google.com',
    identities: { 'google.com': ['10769150350006150715'], email: ['Ann@Example.com'] },
  },
}
const user = {
  email: 'ann@example.com',
  emailVerified: true,
  providerData: [{ providerId: 'google.com', uid: '10769150350006150715' }],
}

describe('trial history keys', () => {
  test('a token and the user record of the same person give the same keys', () => {
    const fromToken = history.identityKeys(identityFromToken(token))
    assert.deepEqual(fromToken, history.identityKeys(identityFromUser(user)))
    assert.deepEqual(
      fromToken.map(key => key.kind),
      ['identity', 'email'],
    )
    for (const key of fromToken) assert.match(key.id, /^[0-9a-f]{64}$/)
  })

  test('an unverified email and an email/password sign-in add no key of their own', () => {
    assert.deepEqual(
      history.identityKeys(
        identityFromUser({
          email: 'ann@example.com',
          emailVerified: false,
          providerData: [{ providerId: 'password', uid: 'ann@example.com' }],
        }),
      ),
      [],
    )
  })

  test('keys depend on the secret, so a guessed address cannot be checked without it', () => {
    const other = new TrialHistory({}, 'another-key')
    assert.notDeepEqual(other.cardKey('fp_1'), history.cardKey('fp_1'))
    assert.notEqual(history.cardKey('fp_1').id, history.cardKey('fp_2').id)
  })

  test('refuses to run without a key', () => {
    assert.throws(() => new TrialHistory({}, ''), /TRIAL_HISTORY_KEY/)
    assert.throws(() => new TrialHistory({}, '  '), /TRIAL_HISTORY_KEY/)
  })
})
