#!/usr/bin/env bash
# Checks, after a Functions deploy, that the per-address limits key on the caller's
# address and not on a Google proxy's (TRUSTED_PROXY_HOPS in
# functions/src/shared/client-address.ts; finding M6).
#
# It sends three requests without an App Check token to the `forecast` Function (each
# is turned away with 401 before any work), then reads the `client address check` log
# line each new instance writes for its first request: the number of X-Forwarded-For
# entries and whether the address the limits use is a real client's (`client`) or a
# Google front-end, private or link-local one (`not-a-client`). No address is logged.
#
# Read-only: it changes nothing, so it runs without --apply. It needs a shell signed in
# with permission to read the project's logs (gcloud auth login as the owner).
#
# Usage:
#   infra/check-client-address.sh
# Options (environment): PROJECT_ID (default uv-activity-planner), FUNCTIONS_URL
# (default https://us-central1-<project>.cloudfunctions.net).
source "$(dirname "$0")/lib.sh"
: "${FUNCTIONS_URL:=https://us-central1-${PROJECT_ID}.cloudfunctions.net}"

for _ in 1 2 3; do
  status="$(curl -s -o /dev/null -w '%{http_code}' "$FUNCTIONS_URL/forecast?lat=0&lon=0")"
  echo "forecast answered $status (401 or 429 expected without an App Check token)"
done
echo "Waiting 30 seconds for the logs to arrive..."
sleep 30

kinds="$(gcloud logging read --project "$PROJECT_ID" --freshness 7d --limit 20 \
  --format 'value(jsonPayload.kind,jsonPayload.forwardedEntries,jsonPayload.function)' \
  'jsonPayload.message="client address check"')"
if [ -z "$kinds" ]; then
  echo "No 'client address check' line yet: run this again in a minute." >&2
  exit 1
fi
echo "kind, X-Forwarded-For entries, function (most recent first):"
echo "$kinds"
if echo "$kinds" | grep -qv '^client'; then
  echo "FAIL: some Functions key their limits on a proxy address." >&2
  echo "Set TRUSTED_PROXY_HOPS in functions/src/shared/client-address.ts to match (docs/DEPLOYMENT.md, \"Check the client address at the first deploy\")." >&2
  exit 1
fi
echo "OK: the per-address limits key on the caller's address."
