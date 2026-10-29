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
# Two parts, for the two stages (REVIEW8 QA H2):
# - --site-only, for the free (Spark) plan before any Functions exist (Cloud Monitoring
#   needs no billing for this; if Google Cloud asks for a billing account anyway, use a
#   free external monitor on the same page, docs/RUNBOOK.md "Free stage"): only the
#   email channel, the app page's uptime check and the uptime alert policy.
# - --functions-only, at the Pro launch after a --site-only run: the Functions' uptime
#   check and the error alert policy, sent to the channel the first part created
#   (CHANNEL=projects/<project>/notificationChannels/<id>, from
#   `gcloud beta monitoring channels list --project uv-activity-planner`). The uptime
#   policy already covers every uptime check, the Functions' one included.
# With neither, it creates everything at once.
#
# Usage (each prints the commands; add --apply to run them):
#   ALERT_EMAIL=you@example.com infra/monitoring.sh
#   ALERT_EMAIL=you@example.com infra/monitoring.sh --site-only
#   CHANNEL=projects/uv-activity-planner/notificationChannels/123 infra/monitoring.sh --functions-only
# The `gcloud beta monitoring` commands need the beta component (gcloud components
# install beta). Check each command with --help if gcloud reports an unknown flag.
# shellcheck source=infra/lib.sh
source "$(dirname "$0")/lib.sh"
: "${REGION:=us-central1}"
# The app's host for its uptime check: production's site unless set, for example
# SITE_HOST=solara-staging.web.app with PROJECT_ID=solara-staging.
: "${SITE_HOST:=solara-uv.web.app}"

SITE=true
FUNCTIONS=true
for arg in "$@"; do
  case "$arg" in
    --site-only) FUNCTIONS=false ;;
    --functions-only) SITE=false ;;
    --apply) ;;
    *)
      echo "Unknown option: $arg (use --site-only or --functions-only, and --apply)" >&2
      exit 2
      ;;
  esac
done
if [ "$SITE" = false ] && [ "$FUNCTIONS" = false ]; then
  echo "Use --site-only or --functions-only, not both" >&2
  exit 2
fi

if [ "$SITE" = true ]; then
  require ALERT_EMAIL
  run gcloud services enable monitoring.googleapis.com --project "$PROJECT_ID"
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
    --resource-labels "host=$SITE_HOST,project_id=$PROJECT_ID" \
    --protocol https --path /app/ --period 5 --timeout 10
else
  # The channel the --site-only run created.
  require CHANNEL
fi

POLICIES=()
if [ "$SITE" = true ]; then POLICIES+=(uptime); fi
if [ "$FUNCTIONS" = true ]; then
  run gcloud services enable monitoring.googleapis.com logging.googleapis.com --project "$PROJECT_ID"
  run gcloud monitoring uptime create "Solara Functions" --project "$PROJECT_ID" \
    --resource-type uptime-url \
    --resource-labels "host=$REGION-$PROJECT_ID.cloudfunctions.net,project_id=$PROJECT_ID" \
    --protocol https --path /stripeWebhook --period 5 --timeout 10 --status-codes 405
  POLICIES+=(errors)
fi

for policy in "${POLICIES[@]}"; do
  file="$(dirname "$0")/alerts/$policy.json"
  if [ "$APPLY" = true ]; then
    sed "s#\"CHANNEL\"#\"$CHANNEL\"#" "$file" >"${TMPDIR:-/tmp}/solara-alert-$policy.json"
    gcloud beta monitoring policies create --project "$PROJECT_ID" \
      --policy-from-file "${TMPDIR:-/tmp}/solara-alert-$policy.json"
  else
    echo "# $file, with \"CHANNEL\" replaced by the channel ${CHANNEL}:"
    run gcloud beta monitoring policies create --project "$PROJECT_ID" --policy-from-file "$file"
  fi
done
