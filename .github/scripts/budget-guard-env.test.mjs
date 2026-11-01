// Both deploys that ship the budget kill switch refuse to run without its budget id and
// its own identity, and the budget guard deploy loads the guard alone.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { budgetGuardEnv, budgetGuardProblems } from './budget-guard-env.mjs'

const PROJECT = 'uv-activity-planner'
const ACCOUNT = `solara-budget@${PROJECT}.iam.gserviceaccount.com`
const BUDGET = 'de72f49d-779b-4945-a127-4d6ce8def0bb'

test('accepts the values infra/budget.sh prints', () => {
  assert.deepEqual(
    budgetGuardProblems({ projectId: PROJECT, budgetId: BUDGET, budgetServiceAccount: ACCOUNT }),
    [],
  )
  assert.deepEqual(
    budgetGuardProblems({
      projectId: PROJECT,
      budgetId: `billingAccounts/01D4EE-079462-DFD6EC/budgets/${BUDGET}`,
      budgetServiceAccount: ` ${ACCOUNT} `,
    }),
    [],
  )
})

test('refuses a missing BUDGET_ID or BUDGET_SERVICE_ACCOUNT', () => {
  const [noId] = budgetGuardProblems({ projectId: PROJECT, budgetServiceAccount: ACCOUNT })
  assert.match(noId, /Set the BUDGET_ID repository variable/)
  const [noAccount] = budgetGuardProblems({ projectId: PROJECT, budgetId: BUDGET })
  assert.match(noAccount, /Set the BUDGET_SERVICE_ACCOUNT repository variable/)
  assert.equal(budgetGuardProblems({ projectId: PROJECT, budgetId: ' ' }).length, 2)
})

test("refuses a malformed budget id or another project's identity", () => {
  assert.match(
    budgetGuardProblems({ projectId: PROJECT, budgetId: 'a b', budgetServiceAccount: ACCOUNT })[0],
    /not a budget id/,
  )
  assert.match(
    budgetGuardProblems({
      projectId: PROJECT,
      budgetId: BUDGET,
      budgetServiceAccount: 'solara-budget@solara-staging.iam.gserviceaccount.com',
    })[0],
    /not a service account of uv-activity-planner/,
  )
})

test('writes the guard-only set and its params', () => {
  assert.equal(
    budgetGuardEnv({ budgetId: BUDGET, budgetServiceAccount: ACCOUNT, detachBilling: true }),
    `SOLARA_FUNCTION_SET=budget-guard\nCOST_GUARD_DETACH_BILLING=true\nBUDGET_ID=${BUDGET}\nBUDGET_SERVICE_ACCOUNT=${ACCOUNT}\n`,
  )
  assert.match(
    budgetGuardEnv({ budgetId: BUDGET, budgetServiceAccount: ACCOUNT, detachBilling: false }),
    /^COST_GUARD_DETACH_BILLING=false$/m,
  )
})
