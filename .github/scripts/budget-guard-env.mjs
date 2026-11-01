#!/usr/bin/env node
// The budget kill switch's deploy settings (deploy.yml), checked before any Functions
// deploy on production and written for the budget guard deploy.
//
// Both deploys that ship `budgetAlert` refuse to run until infra/budget.sh has run and
// the owner set the two repository variables it prints:
// - BUDGET_ID, so the switch acts only on Solara's budget (unset, it would act on any
//   budget that points at its topic);
// - BUDGET_SERVICE_ACCOUNT, the switch's own identity, the only one allowed to detach
//   billing (unset, the function runs as the default identity and cannot detach it).
// Deploying the switch without them would look like a working spending limit and not be
// one.
//
// Messages never repeat the variables' values, so nothing from the environment is logged.
//
// Usage (in the workflow, with BUDGET_ID, BUDGET_SERVICE_ACCOUNT and
// COST_GUARD_DETACH_BILLING in the environment):
//   node .github/scripts/budget-guard-env.mjs <projectId>
//       checks the settings; prints ::error:: lines and exits 1 when one is missing
//   node .github/scripts/budget-guard-env.mjs <projectId> --write
//       also appends the budget guard's params to functions/.env.<projectId>, with
//       SOLARA_FUNCTION_SET=budget-guard so the deploy loads the guard alone
import { appendFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * What is wrong with the budget guard's settings for a project, as messages.
 * @param {{ projectId: string, budgetId?: string, budgetServiceAccount?: string }} settings
 * @returns {string[]}
 */
export function budgetGuardProblems({ projectId, budgetId = '', budgetServiceAccount = '' }) {
  const problems = []
  const id = budgetId.trim()
  const account = budgetServiceAccount.trim()
  if (!id) {
    problems.push(
      'Set the BUDGET_ID repository variable (infra/budget.sh prints it) before deploying the budget kill switch; without it the switch would act on any budget.',
    )
  } else if (!/^(billingAccounts\/[A-Z0-9-]+\/budgets\/)?[A-Za-z0-9-]+$/.test(id)) {
    problems.push(
      'BUDGET_ID is not a budget id or budget name; use the value infra/budget.sh printed.',
    )
  }
  if (!account) {
    problems.push(
      'Set the BUDGET_SERVICE_ACCOUNT repository variable (infra/budget.sh prints it) before deploying the budget kill switch; without it the switch cannot detach billing.',
    )
  } else if (!account.endsWith(`@${projectId}.iam.gserviceaccount.com`)) {
    problems.push(
      `BUDGET_SERVICE_ACCOUNT is not a service account of ${projectId}; use the one infra/budget.sh printed.`,
    )
  }
  return problems
}

/**
 * The dotenv lines that make a Functions deploy ship the budget guard alone.
 * @param {{ budgetId: string, budgetServiceAccount: string, detachBilling: boolean }} settings
 * @returns {string}
 */
export function budgetGuardEnv({ budgetId, budgetServiceAccount, detachBilling }) {
  return [
    'SOLARA_FUNCTION_SET=budget-guard',
    `COST_GUARD_DETACH_BILLING=${detachBilling ? 'true' : 'false'}`,
    `BUDGET_ID=${budgetId.trim()}`,
    `BUDGET_SERVICE_ACCOUNT=${budgetServiceAccount.trim()}`,
    '',
  ].join('\n')
}

function main(args) {
  const projectId = args.find(arg => !arg.startsWith('--'))
  if (!projectId) throw new Error('usage: budget-guard-env.mjs <projectId> [--write]')
  const settings = {
    projectId,
    budgetId: process.env.BUDGET_ID ?? '',
    budgetServiceAccount: process.env.BUDGET_SERVICE_ACCOUNT ?? '',
  }
  const problems = budgetGuardProblems(settings)
  for (const problem of problems) console.log(`::error::${problem}`)
  if (problems.length) process.exit(1)
  if (args.includes('--write')) {
    const file = fileURLToPath(new URL(`../../functions/.env.${projectId}`, import.meta.url))
    appendFileSync(
      file,
      budgetGuardEnv({
        ...settings,
        // On unless the owner set the repository variable to false, as for every Function.
        detachBilling: process.env.COST_GUARD_DETACH_BILLING !== 'false',
      }),
    )
    console.log(`Wrote the budget guard's params to functions/.env.${projectId}.`)
  } else {
    console.log('The budget kill switch settings are complete.')
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
