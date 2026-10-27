#!/usr/bin/env bash
# Uptime checks and alerts for production (roadmap item 11; docs/RUNBOOK.md, "Alerts").
#
# Creates:
# - an email notification channel for ALERT_EMAIL;
# - two uptime checks, every 5 minutes: the app page, and the Functions (the Stripe
#   webhook's URL answers a GET with 405, which proves the service is up without
#   calling Stripe);
# - the alert policies in infra/alerts/: any ERROR log from the Functions or Cloud
#   Scheduler (failed requests, webhook failures, failed maintenance tasks, stalled or
#   given-up deletions, the cost guard and the billing kill switch), and failing uptime
#   checks.
#
# Cost: uptime checks are free up to 1 million executions a month per project (these
# two use about 52,000); alerting policies are free until September 1, 2027, then
# $0.35 a month per metric reference (docs/COSTS.md).
#
# Usage:
#   ALERT_EMAIL=you@example.com infra/monitoring.sh           # print the commands
#   ALERT_EMAIL=you@example.com infra/monitoring.sh --apply   # run them
# The `gcloud beta monitoring` commands need the beta component (gcloud components
# install beta). Check each command with --help if gcloud reports an unknown flag.
source "$(dirname "$0")/lib.sh"
require ALERT_EMAIL
: "${REGION:=us-central1}"

run gcloud services enable monitoring.googleapis.com logging.googleapis.com --project "$PROJECT_ID"

CHANNEL="projects/$PROJECT_ID/notificationChannels/<channel-id>"
if [ "$APPLY" = true ]; then
  CHANNEL="$(gcloud beta monitoring channels create --project "$PROJECT_ID" \
    --display-name "Solara owner" --type email \
    --channel-labels "email_address=$ALERT_EMAIL" --format 'value(name)')"
else
  run gcloud beta monitoring channels create --project "$PROJECT_ID" \
    --display-name "Solara owner" --type email --channel-labels "email_address=$ALERT_EMAIL"
fi

run gcloud monitoring uptime create "Solara app" --project "$PROJECT_ID" \
  --resource-type uptime-url \
  --resource-labels "host=solara-uv.web.app,project_id=$PROJECT_ID" \
  --protocol https --path /app/ --period 5 --timeout 10
run gcloud monitoring uptime create "Solara Functions" --project "$PROJECT_ID" \
  --resource-type uptime-url \
  --resource-labels "host=$REGION-$PROJECT_ID.cloudfunctions.net,project_id=$PROJECT_ID" \
  --protocol https --path /stripeWebhook --period 5 --timeout 10 --status-codes 405

for policy in errors uptime; do
  file="$(dirname "$0")/alerts/$policy.json"
  if [ "$APPLY" = true ]; then
    sed "s#\"CHANNEL\"#\"$CHANNEL\"#" "$file" >"${TMPDIR:-/tmp}/solara-alert-$policy.json"
    gcloud beta monitoring policies create --project "$PROJECT_ID" \
      --policy-from-file "${TMPDIR:-/tmp}/solara-alert-$policy.json"
  else
    echo "# $file, with \"CHANNEL\" replaced by the channel created above:"
    run gcloud beta monitoring policies create --project "$PROJECT_ID" --policy-from-file "$file"
  fi
done
