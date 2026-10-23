const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const { HttpError, loggableError } = require('../lib/shared/errors')
const { redact } = require('../lib/shared/logging')

// Built at run time so secret scanners do not mistake the fixtures for real credentials.
const segment = (length, char) => char.repeat(length)
const ID_TOKEN = [segment(36, 'h'), segment(48, 'p'), segment(43, 's')].join('.')
const FCM_TOKEN = `fcm:${segment(140, 'f')}`

describe('log redaction', () => {
  test('removes emails, URL query strings, coordinates and tokens', () => {
    assert.equal(
      redact('Invalid email address: alice.smith+uv@example.co.uk'),
      'Invalid email address: [email]',
    )
    assert.equal(
      redact('GET https://api.open-meteo.com/v1/forecast?latitude=47.61&longitude=-122.33 failed'),
      'GET https://api.open-meteo.com/v1/forecast?[redacted] failed',
    )
    assert.equal(
      redact('location {"lat": 47.61, "lon":-122.33}'),
      'location {"lat": [redacted], "lon":[redacted]}',
    )
    assert.equal(redact(`Bearer ${ID_TOKEN} rejected`), 'Bearer [token] rejected')
    assert.equal(redact(`token ${FCM_TOKEN}`), 'token fcm:[token]')
  })

  test('keeps the ids that make a log useful', () => {
    const message =
      'No such customer: cus_PxY12AbCdEf34G for subscription sub_1PqRsTuVwXyZ and uid 3Jx9kQ2mN8pL5vR7tY1wZ4aB6cD0'
    assert.equal(redact(message), message)
  })

  test('loggableError redacts third-party messages but keeps authored ones', () => {
    assert.deepEqual(loggableError(new HttpError('conflict', 'Already subscribed')), {
      name: 'HttpError',
      code: 'conflict',
      message: 'Already subscribed',
    })
    const stripeError = Object.assign(new Error('Invalid email: bob@example.com'), {
      code: 'email_invalid',
    })
    assert.deepEqual(loggableError(stripeError), {
      name: 'Error',
      code: 'email_invalid',
      message: 'Invalid email: [email]',
    })
    assert.deepEqual(loggableError('boom'), { name: 'string' })
  })
})
