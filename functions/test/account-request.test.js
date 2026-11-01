// The emailed request script (infra/account-request.mjs) deletes nothing without the
// date of the reply that confirmed the request from the account's own address (REVIEW9
// SEC9 L4). Its export is the Account data page's own file (readAccountExport), tested
// with the Function in test/emulator/lifecycle.test.js.
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const SCRIPT = path.join(__dirname, '../../infra/account-request.mjs')

/** Runs the script; every case here stops before it reaches Firebase. */
function run(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PROJECT_ID: 'demo-solara-none' },
    timeout: 20_000,
  })
  return { status: result.status, stderr: result.stderr }
}

describe('account-request.mjs', () => {
  test('refuses to delete without a confirming reply', () => {
    const answer = run('delete', 'abc123', '--apply')
    assert.equal(answer.status, 2)
    assert.match(answer.stderr, /--confirmed-reply YYYY-MM-DD/)
  })

  test('takes only a real date within the last 30 days', () => {
    for (const date of ['', 'yesterday', '2026-02-30', '29-10-2026', '2020-01-01', '2999-01-01']) {
      const answer = run('delete', 'abc123', '--apply', '--confirmed-reply', date)
      assert.equal(answer.status, 2, date)
      assert.match(answer.stderr, /--confirmed-reply/, date)
    }
  })

  test('accepts today and a date within the last 30 days', async () => {
    const { confirmedReply } = await import(SCRIPT)
    const now = new Date('2026-10-29T15:00:00Z')
    assert.equal(confirmedReply(['--confirmed-reply', '2026-10-29'], now), '2026-10-29')
    assert.equal(confirmedReply(['--apply', '--confirmed-reply', '2026-10-01'], now), '2026-10-01')
    assert.equal(confirmedReply(['--apply'], now), null)
  })

  test('still checks the uid first', () => {
    const answer = run('delete', '../users', '--apply', '--confirmed-reply', '2026-10-29')
    assert.equal(answer.status, 2)
    assert.match(answer.stderr, /uid/)
  })
})
