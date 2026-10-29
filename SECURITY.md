# Security policy

## Supported versions

Solara ships by deploy, not by release: every merge to `main` goes to https://solara-uv.web.app.
Only the live site and the current `main` branch are supported; there are no older versions to patch.

| Version | Supported |
| --- | --- |
| https://solara-uv.web.app and `main` | Yes |
| Anything older, forks and local builds | No |

## Reporting a vulnerability

Please report vulnerabilities privately and do not open a public issue, pull request or discussion.

- **GitHub:** once private vulnerability reporting is on, use **Report a vulnerability** on the repository's [Security tab](https://github.com/n8watkins/solara/security); the report stays private between you and the maintainer.
- **Email:** otherwise, or if you prefer, write to **contact@n8builds.dev**.

Include a description, the affected URL or file, steps to reproduce and the impact you expect.
You should get an acknowledgement within 5 business days, and then a reply with the assessment and the planned fix.
Please allow reasonable time for a fix before disclosing the issue, and say whether you would like to be credited.

In scope: the live site, its Firestore rules, the Cloud Functions in `functions/` once deployed, and this repository's workflows.
Out of scope: denial of service by traffic volume, findings that need a compromised device or browser, and the public Firebase web API key on its own (it is public by design; the rules and Auth protect the data).

## How the repository protects its supply chain

- **Workflows** run with `permissions: {}` by default and grant each job only what it needs.
  Only deploy jobs on `main` can request Google Cloud credentials.
- **Actions** are pinned to full commit SHAs, and Dependabot proposes updates weekly after a 7-day cooldown.
- **Dependencies** never run install scripts.
  Both `package.json` files record an `allowScripts` policy that denies every dependency install script found so far (`@firebase/util`, `protobufjs` and `unrs-resolver` in the web app; `@firebase/util`, `protobufjs` and `re2` in `functions/`), so npm 12 installs them without a warning and blocks any new one until it is reviewed with `npm install-scripts`.
  CI runs `npm ci --ignore-scripts`, which applies the same policy (no dependency script runs) with the npm 11 that ships with the pinned Node, since npm 11 does not read `allowScripts`.
- **Deploy tooling** comes from lockfiles: `firebase-tools` is the version locked in `functions/package-lock.json`, never a floating `npx` download.
- **Every pull request** runs actionlint, zizmor, gitleaks over the commits it adds, and `npm audit` on production dependencies of both packages.
  Every push to `main` runs gitleaks over the full history.
- **Production deploys** build the static export once, smoke-test it on the Firebase Hosting emulator, record its SHA-256 digest, SBOMs and a provenance record, and deploy exactly that artifact.
- **Cloud credentials** come from Workload Identity Federation with one deploy identity, limited to `main`, once the owner completes [docs/WIF_SETUP.md](docs/WIF_SETUP.md); until then a service-account key secret is the fallback.
- **Public build values** are checked before every production build (`.github/scripts/check-public-env.mjs`): a secret-shaped value, an App Check debug token, or Functions without App Check fail the deploy.

## Repository settings

The repository is public (owner decision D2, 2026-10-23).
The "Protect main" ruleset requires pull requests, squash merges and the required checks; secret scanning with push protection, CodeQL, Dependabot alerts and security updates are on.
The settings still to turn on (up-to-date branches, CodeQL as a required check, SHA-pinned actions, private vulnerability reporting and a `production` environment) are listed in the [owner checklist](docs/OWNER_CHECKLIST.md#repository).
