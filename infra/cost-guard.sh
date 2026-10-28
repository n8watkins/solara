#!/usr/bin/env bash
# Sets the owner's override on the cost guard (functions/src/shared/cost-guard.ts;
# docs/RUNBOOK.md, "Cost guard"), the Firestore document systemFlags/costGuard:
#
#   released  keeps the guarded paths on, whatever the budget says (for example after
#             raising the budget, or once an attack has stopped);
#   engaged   keeps them off;
#   auto      follows the budget again (a budget-engaged guard also ends by itself at
#             the start of the next budget period).
#
# Each instance re-reads the switch within a minute.
#
# Usage:
#   infra/cost-guard.sh released            # print what would be sent
#   infra/cost-guard.sh released --apply    # send it
# Options (environment): PROJECT_ID (default uv-activity-planner).
source "$(dirname "$0")/lib.sh"

MODE="${1:-}"
case "$MODE" in
  released | engaged | auto) ;;
  *)
    echo "Usage: $0 released|engaged|auto [--apply]" >&2
    exit 2
    ;;
esac

URL="https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/systemFlags/costGuard?updateMask.fieldPaths=override&updateMask.fieldPaths=overrideSetAt"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BODY="{\"fields\":{\"override\":{\"stringValue\":\"${MODE}\"},\"overrideSetAt\":{\"timestampValue\":\"${NOW}\"}}}"

if [ "$APPLY" = true ]; then
  curl -sS --fail-with-body -X PATCH "$URL" \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H 'Content-Type: application/json' \
    -d "$BODY" >/dev/null
  echo "systemFlags/costGuard override is now '${MODE}' in ${PROJECT_ID}; instances follow within a minute."
else
  echo "PATCH $URL"
  echo "$BODY"
  echo "(signed in with gcloud auth print-access-token; run again with --apply to send it)"
fi
