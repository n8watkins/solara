// The deployed entry point (package.json "main" is its compiled lib/index.js).
//
// It exports one set of Cloud Functions (src/function-set.ts): every Function
// (src/all-functions.ts), or with SOLARA_FUNCTION_SET=budget-guard only the budget kill
// switch (src/ops/budget-guard.ts), which then deploys on its own without loading, or
// declaring the secrets of, anything else.

import type * as AllFunctions from './all-functions'
import { functionSet } from './function-set'
import type * as BudgetGuard from './ops/budget-guard'
import { installRequestBodyLimit } from './shared/body-limit'

// Stack traces point at the TypeScript source (lib/ ships with source maps).
process.setSourceMapsEnabled(true)

// Bodies over an endpoint's limit are refused before the Functions Framework reads them
// (REVIEW8 SEC L1); the framework creates its server after loading this module.
installRequestBodyLimit()

// Loaded on demand, so the budget guard alone never loads the other features' modules;
// a static import would load (and declare the secrets of) every Function.
/* eslint-disable @typescript-eslint/no-require-imports */
export = functionSet() === 'budget-guard'
  ? (require('./ops/budget-guard') as typeof BudgetGuard)
  : (require('./all-functions') as typeof AllFunctions)
/* eslint-enable @typescript-eslint/no-require-imports */
