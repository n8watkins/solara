#!/usr/bin/env bash
# The runtime identity of the scheduled Pro alerts (functions/src/notifications/; BE-11).
#
# Creates the `solara-alerts` service account with only what the `alerts` Function
# needs: Firestore reads and writes, sending FCM messages and writing its logs. The
# deploy reads the OPEN_METEO_API_KEY secret binding from the source and grants this
# account access to that one secret itself. It also lets the deploy identity attach the
# account to the Function, and nothing broader.
#
# Afterwards, set the repository variable so the next deploy runs the alerts as it:
#   gh variable set ALERTS_SERVICE_ACCOUNT --repo n8watkins/solara \
#     --body "solara-alerts@${PROJECT_ID}.iam.gserviceaccount.com"
# Until then the alerts run as the project's default compute identity.
#
# Usage:
#   DEPLOY_SA=<deploy service account email> infra/alerts-identity.sh          # print
#   DEPLOY_SA=<deploy service account email> infra/alerts-identity.sh --apply  # run
# Options (environment): PROJECT_ID (default uv-activity-planner).
# shellcheck source=infra/lib.sh
source "$(dirname "$0")/lib.sh"
require DEPLOY_SA

ALERTS_SA="solara-alerts@${PROJECT_ID}.iam.gserviceaccount.com"

run gcloud iam service-accounts create solara-alerts \
  --project "$PROJECT_ID" --display-name "Solara Pro alerts (Cloud Functions)"

for role in roles/datastore.user roles/firebasecloudmessaging.admin roles/logging.logWriter; do
  run gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${ALERTS_SA}" --role "$role" --condition None
done

run gcloud iam service-accounts add-iam-policy-binding "$ALERTS_SA" \
  --project "$PROJECT_ID" \
  --member "serviceAccount:${DEPLOY_SA}" --role roles/iam.serviceAccountUser
