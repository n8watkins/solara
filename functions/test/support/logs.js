// Captures structured log entries instead of printing them, for assertions.
//
// The Functions log through `logger` from firebase-functions/logger; this replaces its
// methods for each test, so the test output stays readable and tests can check the
// severity and fields of what would reach Cloud Logging.
const { afterEach, beforeEach, mock } = require('node:test')
const { logger } = require('firebase-functions/logger')

const SEVERITIES = { debug: 'DEBUG', info: 'INFO', log: 'INFO', warn: 'WARNING', error: 'ERROR' }

/** @returns {{ entries: Array<{ severity: string, message: string, fields: any }> }} */
function captureLogs() {
  const capture = { entries: [] }
  beforeEach(() => {
    capture.entries = []
    for (const [method, severity] of Object.entries(SEVERITIES)) {
      mock.method(logger, method, (message, fields) => {
        capture.entries.push({ severity, message, fields })
      })
    }
  })
  afterEach(() => {
    mock.restoreAll()
  })
  return capture
}

module.exports = { captureLogs }
