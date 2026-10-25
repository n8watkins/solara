# Running roadmap lanes in parallel

This is how the waves in [ROADMAP.md](ROADMAP.md) are executed by several coding agents at once.
It worked for Waves 0-2 (PRs #17-#52) and applies to every later wave.

## Ownership

- Work is split into **waves**.
  Lanes inside a wave run at the same time; a wave starts when the previous wave's lanes are merged.
- Each lane **owns** a set of files.
  Within a wave, no two lanes own the same file.
- A lane may make a small edit to a file it does not own only if that file is listed in its **touch points**, and only the lines described there.
  Anything else is reported to the lead instead of edited.
- New files are owned by the lane that creates them, and a lane owns the existing test files of the source files it owns.
  New test files and new e2e spec files never conflict.
- `package-lock.json` and `functions/package-lock.json` are never hand-merged.
  After rebasing, a lane regenerates them with `npm install` (and `npm install --prefix functions`) and commits the result.
- Docs: a lane updates the doc sections about its own work.
  Current state goes in [status.md](status.md), owner steps in [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md), and finished roadmap items are removed from [ROADMAP.md](ROADMAP.md).

## Agent contract

1. Create a fresh git worktree from the latest `origin/main` on the branch named by the lane.
2. Read [status.md](status.md) and the lane's section of [ROADMAP.md](ROADMAP.md) before changing anything.
3. For each bug, reproduce it first in the closest end-to-end setting available (browser, emulator or test), then fix it, then prove the fix with an automated test.
   For visual changes, capture before and after screenshots with the UI harness (`npm run test:harness`) at 1440 px and 390 px, light and dark.
4. Commit after each logical change with a clear message.
   Never add an agent name as co-author.
   Never use the em dash character; use a plain dash.
5. Before pushing, run the fast checks locally: `npm run lint`, `npm run typecheck`, `npm run check:docs`, `npm test`, `npm run build`, plus any browser, harness or emulator suite whose files you changed (visual work runs `npm run test:harness` for before and after screenshots).
   GitHub Actions then runs every check in the README's [quality checks](../README.md#quality-checks) on the pull request, and the `main` ruleset requires all of them; read the CI results with `gh pr checks` and fix any failure or flake you see, even if unrelated, and mention it.
   This keeps the full browser and emulator suites on CI's runners instead of loading the local machine when several lanes run at once.
   CI runs only the suites a pull request's files can affect, and the others pass in seconds with "No relevant changes"; the [change-aware checks](../README.md#change-aware-checks) table lists which paths run which suite.
   A change under `.github/`, to a lockfile or `package.json`, to shared configuration or to `packages/core` runs everything.
6. Edit only owned files and listed touch points.
   Never edit changelog files or generated files (`next-env.d.ts`, the `AGENTS.md` block that `next dev` writes).
7. Push the branch and open a PR against `main`.
   Do not merge, deploy, or change cloud, GitHub or Stripe settings.
8. Finish with a summary: what changed, test evidence, finding IDs closed, anything deferred, and any owner action now required.

## Merge protocol

- The lead session reviews each PR, waits for green CI, rebases if needed and merges with squash.
- Merging to `main` deploys Hosting, so the owner can ask for approval before each merge.
- Within a wave, merge in the order the roadmap lists, if it lists one; later lanes rebase onto the earlier merges.
- A wave closes when all its PRs are merged and `main` is green.

## Kickoff template

```text
You are implementing lane [LANE-ID] of the Solara roadmap.
Repository: github.com/n8watkins/solara. Create a git worktree from the latest origin/main on branch [branch].
Read docs/status.md, docs/ROADMAP.md and docs/CONTRIBUTING-AGENTS.md first, then follow the "Agent contract" exactly.
Your scope is the [LANE-ID] section of docs/ROADMAP.md: close the listed finding IDs, edit only the files it owns plus its listed touch points, and meet its acceptance criteria.
You may push your branch and open a PR. Do not merge or deploy.
If something needs an owner decision or a file outside your ownership, stop and report it instead of guessing.
```
