# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately and do not open a public issue.
Email the operator at **contact@n8builds.dev** with a description, the affected URL or file, and steps to reproduce.
You should get an acknowledgement within 5 business days.

Only the current production site and the `main` branch are supported.

## How the repository protects its supply chain

- **Workflows** run with `permissions: {}` by default and grant each job only what it needs.
  Only deploy jobs on `main` can request Google Cloud credentials.
- **Actions** are pinned to full commit SHAs, and Dependabot proposes updates weekly after a 7-day cooldown.
- **Dependencies** never run install scripts.
  Both `package.json` files record an `allowScripts` policy that denies every dependency install script found so far (`@firebase/util`, `protobufjs` and `unrs-resolver` in the web app; `@firebase/util`, `protobufjs` and `re2` in `functions/`), so npm 12 installs them without a warning and blocks any new one until it is reviewed with `npm install-scripts`.
  CI runs `npm ci --ignore-scripts`, which applies the same policy (no dependency script runs) with the npm 11 that ships with the pinned Node, since npm 11 does not read `allowScripts`.
- **Deploy tooling** comes from lockfiles: `firebase-tools` is the version locked in `functions/package-lock.json`, never a floating `npx` download.
- **Every pull request** runs actionlint, zizmor, gitleaks over the full history, and `npm audit` on production dependencies of both packages.
- **Production deploys** build the static export once, smoke-test it on the Firebase Hosting emulator, record its SHA-256 digest, SBOMs and a provenance record, and deploy exactly that artifact.
- **Cloud credentials** come from Workload Identity Federation with separate deploy and notifier identities once the owner completes [docs/WIF_SETUP.md](docs/WIF_SETUP.md); until then a service-account key secret is the fallback.

## Repository settings

The repository is private on GitHub Free (owner decision D2), so branch protection, rulesets, environments, secret scanning and CodeQL are unavailable, and any push to `main` deploys to production.
If the repository becomes public or moves to GitHub Pro, turn on:

- a ruleset for `main` that requires pull requests and the CI checks to pass;
- a `production` environment with a required reviewer for the deploy jobs;
- secret scanning with push protection, and private vulnerability reporting;
- CodeQL default setup for JavaScript and TypeScript.

Dependabot alerts and Dependabot security updates work on private repositories and should be on now.
