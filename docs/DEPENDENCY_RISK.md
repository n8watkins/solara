# Dependency Risk Record

_Last reviewed: 2026-07-15_

## Current result

The root dependency audit reports zero high or critical advisories and six moderate advisories.
The Functions dependency audit reports zero high or critical advisories and twelve moderate advisories.
CI runs both audits with `--audit-level=high`, so a newly introduced high or critical advisory blocks deployment.

## Temporary acceptance

The remaining findings are transitive dependencies in the Firebase client, administration, Functions, and tooling dependency trees.
The available automated remediation proposes breaking or unsafe major-version changes rather than a compatible patch.
These moderate findings are temporarily accepted while upstream packages are monitored, provided the high-severity CI gates continue to pass.

## Required review

Re-run both audits before each production release and before enabling Firebase Functions or Stripe.
Upgrade compatible direct dependencies when upstream releases remove the affected transitive packages.
Revisit this acceptance immediately if an advisory becomes high severity, becomes remotely exploitable in Solara's deployed paths, or receives a compatible remediation.
