# Dependency Risk Record

_Last reviewed: 2026-10-23_

## Current result

Production dependencies in both the app and Functions report zero advisories (`npm audit --omit=dev`).
Firebase's client SDK still pins `@grpc/grpc-js ~1.9.0`, so both packages override it to `^1.14.6` to remove two gRPC advisories; Firestore rules tests and Functions tests pass with the override.

Development dependencies still report moderate advisories that have no compatible fix (checked 2026-10-23):

| Package | Severity | Reached through | Notes |
| --- | --- | --- | --- |
| `postcss-selector-parser <7.1.6` | Moderate | `tailwindcss@3` (app) | Build tooling only; the Tailwind 4 migration (roadmap W4-0) removes it. |
| `@opentelemetry/core <2.8.0` | Moderate | `firebase-tools` (Functions) | Emulator and CLI tooling only; the only fix is a firebase-tools downgrade. |
| `uuid <11.1.1` | Moderate | `firebase-tools` through `gaxios` (Functions) | Only affects calls that pass a caller-supplied buffer; same fix situation. |

npm reports the chain packages (`tailwindcss`, `postcss-nested`, `firebase-tools`, `gaxios`, `@google-cloud/pubsub`) as moderate too, because they depend on the packages above.
The `braces` advisory that this record used to list is no longer reported.

## CI policy

CI blocks on `npm audit --omit=dev --audit-level=high` for both packages, so any high or critical advisory in shipped code stops deployment.
CI also runs the full audit, including development dependencies, as a non-blocking step so new tooling advisories stay visible in every run.

## Required review

Re-run both audits before each production release and before enabling Firebase Functions or Stripe.
Remove the `@grpc/grpc-js` override once the Firebase client SDK depends on a fixed version.
Revisit this record when Tailwind 4 lands, when `firebase-tools` updates its OpenTelemetry and `gaxios` dependencies, or if any development advisory becomes reachable from deployed code.
