# CI: what runs, when, and how long it takes

This page explains which checks run for which change, how long they take, and why CI is set up this way.
The times come from the CI audit of 2026-11-01 (#169), measured on GitHub's hosted runners (4 CPUs) over the last 30 pull request runs and 12 deploys.

## Workflows

- **Pull requests** run `.github/workflows/ci.yml`, which calls the reusable `.github/workflows/quality.yml`.
  A newer push to the same pull request cancels the older run.
- **Pushes to `main`** run `.github/workflows/deploy.yml`: the same `quality.yml` (see [Deploys](#deploys) for when its suites skip), a production build that is smoke-tested and packaged, then the Firestore, Functions and Hosting deploy jobs.
- **Staging** (`.github/workflows/deploy-staging.yml`) runs only by hand.
- **CodeQL** runs on its own for pull requests and pushes; it is not part of `quality.yml`.

## The quality jobs

Every job below reports on every pull request, because the `main` ruleset requires them.
A job with nothing relevant to test never skips at the job level (a required check that never reports leaves the pull request pending forever); it starts, skips its steps and passes with "No relevant changes" and the reason in its summary.

| Job (required check) | What it runs | Typical time when it runs |
| --- | --- | --- |
| Detect changed areas | Maps the changed files to suites (`.github/scripts/changed-areas.mjs`) and records the tree it tests | 5 s |
| Lint, types and unit tests | Dependency audit, ESLint and Prettier, the em dash check, shellcheck, the docs check (always); typecheck and Vitest (when relevant) | 1.5-2 min (1.3 min lint only) |
| Browser tests on the static export | Builds `out/` and runs the Playwright suite on the Hosting emulator (Chromium, a phone, and Firefox and WebKit for the Outlook popup), then the first-load budgets on a production-like build (which also fail if Valibot, Firebase or Google Analytics is in a guest's first load) | 4.4 min (5 min before the audit) |
| Browser tests with Sentry and App Check switched on | A production build with fake Sentry and reCAPTCHA keys | 1.5 min |
| Signed-in browser tests on emulators | An emulator build and the signed-in suite against Auth, Firestore and Functions emulators | 3.5 min |
| Signed-in UI harness | Waits for the four harness shards and merges their screenshots and axe reports | 20 s after the slowest shard |
| UI harness shard N of 4 (not required itself) | Builds the harness export and captures its share of about 1,460 screens and checks | 4.4-5.9 min each (5.5-8.4 min before the audit) |
| Functions and Firestore rules | Functions audit, typecheck and tests, the deploy params and payload checks, the rules tests on the emulator | 2 min |
| Workflow and secret scanning | actionlint, zizmor, gitleaks and the workflow script tests (`node --test .github/scripts/*.test.mjs`) | 20 s |
| Dependency review | GitHub's dependency review (pull requests only) | 10 s |

Inside the long jobs, the time goes to the tests themselves, not to setup:

- Each harness shard spends about 25 s installing dependencies and Chromium, 40 s building the harness export and 4-5 min running its screens on four workers.
- The static export job spends about 70 s on setup, 45 s on its two builds and 2.8 min running 182 tests on two workers.
- Installing dependencies takes 15-25 s per job with npm's cache restored; downloading Chromium's headless shell takes about 4 s.

## What runs for which change

Rows are checked top to bottom and the first match decides, so a more specific row wins.
When in doubt the map runs a suite: an unknown path, an empty diff, a manual run or a failed `changes` job runs everything.
Change the rules and their tests in `.github/scripts/changed-areas.test.mjs` together, and keep this table in step.

| Changed files | Typecheck and unit | Functions and rules | Static export e2e | Signed-in e2e | UI harness | Sentry and App Check e2e |
| --- | --- | --- | --- | --- | --- | --- |
| `.github/workflows/deploy.yml`, `.github/workflows/deploy-staging.yml`, the deploy-only scripts (`budget-guard-env.mjs`, `staging-target.mjs`, `remove-source-maps.mjs`, `sbom.sh`), `check-docs.mjs`, `check-dashes.mjs`, the workflow script tests except the suite map's, `.github/dependabot.yml`, `.github/zizmor.yml` | - | - | - | - | - | - |
| `.github/scripts/check-functions-params.js`, `.github/scripts/check-functions-payload.js` | - | yes | - | - | - | - |
| `.github/scripts/check-public-env.mjs`, `.github/scripts/check-hosting-target.js` | yes | - | - | - | - | - |
| `.github/scripts/production.json` | yes | yes | - | - | - | - |
| Anything else under `.github/` (the quality workflows, the suite map and its tests, `tested-tree.mjs`, local actions), `package.json`, lockfiles, `tsconfig*.json`, tool configs (next, postcss, eslint, prettier, vitest, playwright), `.nvmrc`, `.env*`, `firebase.json`, `.firebaserc`, `packages/**`, `scripts/build-core.mjs`, `messages/**` | yes | yes | yes | yes | yes | yes |
| Markdown, `docs/**`, `LICENSE`, `CODEOWNERS`, `.gitignore`, `.gitleaksignore`, `.local-ops.yaml` | - | - | - | - | - | - |
| `tests/e2e/signed-in/**` | yes | - | - | yes | - | - |
| `tests/e2e/integrations/**` | yes | - | - | - | - | yes |
| `tests/e2e/serve-export.mjs` | yes | - | yes | - | - | yes |
| `tests/e2e/**` | yes | - | yes | - | - | - |
| `tests/harness/clock.ts`, `tests/harness/fixtures.ts` | yes | - | yes | yes | yes | - |
| `tests/harness/**` | yes | - | - | - | yes | - |
| `lib/**/*.test.ts`, `tests/*.test.ts` | yes | - | - | - | - | - |
| `tests/static-server.mts` | yes | - | yes | yes | yes | - |
| `functions/test/**` | - | yes | - | - | - | - |
| `functions/**`, `firestore.rules` | yes | yes | - | yes | - | - |
| `infra/account-request.mjs` | - | yes | - | - | - | - |
| `infra/*.sh`, `infra/alerts/*.json` | - | - | - | - | - | - |
| `firestore.indexes.json` | - | yes | - | - | - | - |
| `app/**` except CSS, `lib/` Firebase, CSP, error reporting, Sentry, session, account and Functions API modules, `components/` App, ErrorBoundary, SignInScreen and GoogleSignInButton, `instrumentation-client.ts` | yes | - | yes | yes | yes | yes |
| Other `app/**`, `components/**`, `lib/**`, `hooks/**` | yes | - | yes | yes | yes | - |
| `public/**` | yes | - | yes | - | yes | - |
| `scripts/static-pages.mjs` | yes | - | yes | yes | yes | yes |
| Other `scripts/**` | yes | - | yes | yes | - | yes |
| `hosting-redirect/**` | - | - | yes | - | - | - |
| Anything else | yes | yes | yes | yes | yes | yes |

Why the rows that changed in the audit are safe:

- **Deploy workflows and deploy-only scripts** never run on a pull request, and no suite loads them.
  What a pull request can check about them, it checks on every pull request anyway: actionlint and zizmor read every workflow, and the workflow script tests cover `budget-guard-env.mjs`, `staging-target.mjs`, `remove-source-maps.mjs` and the production guards in `deploy.yml` and `deploy-staging.yml`.
  The workflows that run the suites (`ci.yml`, `quality.yml`), the suite map, `tested-tree.mjs` and the local actions still run everything.
- **CI scripts a suite loads** run that suite: `check-public-env.mjs` and `check-hosting-target.js` have unit tests, the Functions job runs the params and payload checks, and `production.json` feeds both.
- **Functions tests** (`functions/test/**`) are run only by the Functions job; the unit tests and the signed-in suite load `functions/src`, never `functions/test`.
- **Operations scripts:** shellcheck (in lint, always) is the only check of `infra/*.sh`, nothing runs the alert policies, and `functions/test/account-request.test.js` runs `infra/account-request.mjs`.
- **`scripts/static-pages.mjs`** was a gap: the harness's server (`tests/harness/serve.mjs`) runs it over the harness export, but a change to it did not run the harness.
- **`messages/**`** already ran everything (no rule knew it); it now has an explicit row, because the web app and the Functions both use the copy.

## Deploys

Before the audit, every push to `main` ran all the quality suites again (about 8 minutes) before deploying, although every recent merge put on `main` exactly the files its pull request had just tested.
Of the 14 merges before the audit, all 14 squash merges produced the very tree GitHub's merge commit for the pull request's last passing CI run had tested.

Now the deploy's `tested` job runs `.github/scripts/tested-tree.mjs`, and the suites skip only when all of these hold:

1. The pushed commit is the merge commit of a pull request into `main`.
2. A CI run for that pull request's final head commit passed and recorded the tree it tested (the `tested-tree-<tree>` artifact from the `changes` job), and that tree is the pushed commit's own tree.
   A pull request's CI tests GitHub's merge of the pull request into its base, so this fails whenever `main` moved on between that CI run and the merge (including a re-run of an old CI run, which keeps its old merge).
3. `main` before the merge (the commit's first parent) passed every quality check in a Deploy run of its own.
   A pull request runs only the suites its files can affect, so the parent's passing run vouches for the suites the pull request skipped.

Anything else runs every suite as before: a direct push, a merge after `main` moved on, a parent whose deploy failed or was cancelled, a manual run, any GitHub API error, or a failure of the `tested` job itself.
When the suites skip, each still reports, with "this exact tree already passed every suite" and the pull request, CI run and parent Deploy run in its summary.
Lint, the docs check, the dependency audit and workflow and secret scanning (which scans all of `main`'s history on a push) still run, and the production build is still smoke-tested on the Hosting emulator before it ships.

The proof does not add trust in pull request code: the artifact can only claim a tree that `main` then really has, so a pull request that faked it would have to put its own `quality.yml` on `main`, which a deploy would run anyway.

A manual run of the Deploy workflow always runs every suite.

## Typical times by change

Wall clock for the whole CI run, from the first job starting to the last one finishing.
"Before" is measured on the runs of 2026-11-01; "after" is measured on #169 where it ran, and estimated from the measured job times otherwise.

| Change | What runs | Before | After |
| --- | --- | --- | --- |
| Docs only | Always-on checks | 1.5 min | 1.5 min |
| Deploy workflow or deploy-only script (like #167's `deploy.yml` part) | Always-on checks | 8.5 min (everything) | 1.5 min |
| Functions tests only | Functions job | 3.7 min | 2 min |
| Functions code or rules | Unit, Functions, signed-in | 3.7 min | 3 min |
| App UI (`components/`, `app/`, `lib/`) | Unit, static export, signed-in, harness (and integrations on their path) | 8.5 min | 6.2 min |
| Core, `messages/`, lockfiles, quality workflows | Everything | 8.5 min | 6.2 min |
| Deploy of a merge whose tree its pull request passed | Always-on checks, build, smoke test, deploy | 9 min | about 3 min |
| Deploy otherwise (direct push, `main` moved on, parent failed, manual run) | Everything, build, deploy | 9 min | about 7 min |

The full run is bounded by the slowest harness shard.
On #169 the harness shards took 4.4-5.9 min (4.0-5.1 min of tests) instead of 5.5-8.4 min, and the static export job 4.4 min (2.8 min of tests) instead of 5 min, with no flaky test.
Each shard is one Playwright project, in order: desktop light, desktop dark, mobile light, mobile dark; the mobile shards take about a minute longer because their screenshots render at twice the pixel density.

Times are from the first job starting to the last finishing.
When several pull requests run at once they share the account's concurrent runner limit, and jobs can wait several minutes for a runner before they start; on #169 the harness shards waited up to 12 minutes behind another lane's jobs, so the run took 18 minutes from push to green.

## Choices the audit made, and what it left alone

- **Harness workers:** each shard now runs one Playwright worker per CPU (4) instead of Playwright's default of half (2), which cut each shard's test time by about 30%.
- **Four harness shards, not five:** a fifth shard would cut the slowest shard by about a minute, but each pull request would hold one more runner, and runner waits already cost more than that when lanes run in parallel.
  Playwright shards by test count, not time, so the only finer balance would be a hand-kept test list, which would silently skip new screens when it goes stale.
- **Static export workers:** two on CI instead of one, as the signed-in and integration suites already use (the one came from Playwright's project template); the tests take 2.8 min instead of 3.7.
- **Chromium's headless shell only:** every suite runs headless, so the jobs install `--only-shell` and skip the full Chrome for Testing download.
- **No shared harness build:** the four shards build the same harness export (about 40 s each).
  Building it once in its own job would save runner minutes but add that job's setup and upload before any shard starts, so the run would take longer; the owner asked for time.
- **No Next.js build cache:** a restored `.next/cache` has shipped stale Tailwind CSS before, and a build that fails to reflect its source is worse than 10 s saved.
- **No Playwright browser cache:** with the headless shell only, the download takes about 4 s, about what restoring a cache of it takes, and the system packages still install either way.
- **No `node_modules` cache:** `npm ci` from npm's restored cache takes 15-25 s; caching `node_modules` itself would save about 10 s per job and add a cache that can drift from the lockfile.
- **The harness and the static export tests overlap little:** both visit the public pages, but the harness checks layout and accessibility at four sizes and themes on its own build, while the static export tests check behaviour, headers and redirects on the Hosting emulator; neither covers the other.
- **Flakes found:** two tests failed on `main`'s deploy runs (the closed Google popup in `tests/e2e/signed-in/scheduled.e2e.ts`, 3 of 12 deploys, and the Microsoft redirect page in Firefox, 4 of 10 pull request runs); #168 fixed both before this audit, and the deploy after it passed.
