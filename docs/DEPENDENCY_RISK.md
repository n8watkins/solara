# Dependency Risk Record

_Last reviewed: 2026-10-23_

## Current result

Production dependencies in both the app and Functions report zero advisories (`npm audit --omit=dev`).
Firebase's client SDK still pins `@grpc/grpc-js ~1.9.0`, so both packages override it to `^1.14.6` to remove two gRPC advisories; Firestore rules tests and Functions tests pass with the override.

Development dependencies still report advisories that have no compatible fix:

| Package | Severity | Reached through | Notes |
| --- | --- | --- | --- |
| `braces <=3.0.3` | High | `tailwindcss@3` (app), `firebase-tools` (Functions) | No fixed release exists. Exploitation needs attacker-controlled glob patterns, which build and emulator tooling never receives. Tailwind 4 removes it from the app. |
| `postcss-selector-parser <7.1.6` | Moderate | `tailwindcss@3` | Removed by the Tailwind 4 migration. |
| `@opentelemetry/core <2.8.0` | Moderate | `firebase-tools` | Emulator and CLI tooling only. |
| `uuid <11.1.1` | Moderate | `firebase-tools` | Only affects calls that pass a caller-supplied buffer. |

## CI policy

CI blocks on `npm audit --omit=dev --audit-level=high` for both packages, so any high or critical advisory in shipped code stops deployment.
CI also runs the full audit, including development dependencies, as a non-blocking step so new tooling advisories stay visible in every run.

## Required review

Re-run both audits before each production release and before enabling Firebase Functions or Stripe.
Remove the `@grpc/grpc-js` override once the Firebase client SDK depends on a fixed version.
Revisit this record when Tailwind 4 lands, when `firebase-tools` drops `chokidar@3`, or if any development advisory becomes reachable from deployed code.
