#!/usr/bin/env bash
# The Cloud Billing budget and the Pub/Sub topic behind the budget kill switch
# (functions/src/ops/budget.ts; docs/RUNBOOK.md, "Budget kill switch").
#
# Creates:
# - the `budget-alerts` Pub/Sub topic, which the `budgetAlert` Function subscribes to
#   (deploying the Function also creates the topic if it is missing);
# - permission for Cloud Billing's budget service to publish to it;
# - a monthly budget for this project (default $5) with email alerts at 50%, 90% and
#   100% of actual spend and 100% of forecast spend, publishing to the topic.
#
# Optional, last resort (only with DETACH_BILLING=true): lets the Functions' runtime
# service account detach the project from its billing account, which the kill switch
# does only when the COST_GUARD_DETACH_BILLING repository variable is true.
#
# Usage:
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX infra/budget.sh            # print the commands
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX infra/budget.sh --apply    # run them
# Options (environment): PROJECT_ID (default uv-activity-planner), BUDGET_AMOUNT
# (default 5USD), DETACH_BILLING (default false).
source "$(dirname "$0")/lib.sh"
require BILLING_ACCOUNT
: "${BUDGET_AMOUNT:=5USD}"
: "${DETACH_BILLING:=false}"

TOPIC=budget-alerts

run gcloud services enable billingbudgets.googleapis.com cloudbilling.googleapis.com \
  pubsub.googleapis.com --project "$PROJECT_ID"
run gcloud pubsub topics create "$TOPIC" --project "$PROJECT_ID"
# Cloud Billing publishes budget notifications as this Google-managed account.
run gcloud pubsub topics add-iam-policy-binding "$TOPIC" --project "$PROJECT_ID" \
  --member serviceAccount:billing-budget-alert@system.gserviceaccount.com \
  --role roles/pubsub.publisher
run gcloud billing budgets create \
  --billing-account "$BILLING_ACCOUNT" \
  --display-name "Solara monthly ($PROJECT_ID)" \
  --budget-amount "$BUDGET_AMOUNT" \
  --calendar-period month \
  --filter-projects "projects/$PROJECT_ID" \
  --threshold-rule percent=0.5 \
  --threshold-rule percent=0.9 \
  --threshold-rule percent=1.0 \
  --threshold-rule percent=1.0,basis=forecasted-spend \
  --notifications-rule-pubsub-topic "projects/$PROJECT_ID/topics/$TOPIC"

if [ "$DETACH_BILLING" = true ]; then
  # Cloud Functions (2nd gen) run as the default compute service account unless a
  # function names another. Project Billing Manager on the project is enough to remove
  # the project's billing account; Google's guide ("Disable billing usage with
  # notifications") grants Billing Account Administrator on the billing account instead.
  PROJECT_NUMBER="<project-number>"
  if [ "$APPLY" = true ]; then
    PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
  fi
  run gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role roles/billing.projectManager
  echo "Then set the COST_GUARD_DETACH_BILLING repository variable to true and deploy." >&2
fi
