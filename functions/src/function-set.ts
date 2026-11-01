// Which Cloud Functions the entry point (src/index.ts) loads.
//
// `all` (the default) is every Function. `budget-guard` is only the budget kill switch,
// `budgetAlert` (src/ops/budget-guard.ts), so the guard can deploy on Blaze before and
// without the other Functions: their secrets are never declared, so `firebase deploy`
// does not ask Secret Manager for them, and their code never loads.
//
// `firebase deploy` reads it from functions/.env.<project> while it analyzes the source,
// and the deployed function then runs with the same value. Only the budget guard job in
// .github/workflows/deploy.yml writes `budget-guard` there (docs/DEPLOYMENT.md, "Budget
// guard on its own"); the full Functions deploy leaves it unset.

export const FUNCTION_SETS = ['all', 'budget-guard'] as const

export type FunctionSet = (typeof FUNCTION_SETS)[number]

/** The set SOLARA_FUNCTION_SET names; unset or empty is `all`, anything else throws. */
export function functionSet(env: NodeJS.ProcessEnv = process.env): FunctionSet {
  const value = env.SOLARA_FUNCTION_SET?.trim() || 'all'
  const known = FUNCTION_SETS.find(set => set === value)
  if (!known) {
    throw new Error(
      `SOLARA_FUNCTION_SET is ${JSON.stringify(value)}; use one of ${FUNCTION_SETS.join(', ')}`,
    )
  }
  return known
}
