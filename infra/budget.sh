#!/usr/bin/env bash
# The Cloud Billing budget, the Pub/Sub topic and the identity behind the budget kill
# switch (functions/src/ops/budget.ts; docs/RUNBOOK.md, "Budget kill switch").
#
# Creates:
# - the `budget-alerts` Pub/Sub topic, which the `budgetAlert` Function subscribes to
#   (deploying the Function also creates the topic if it is missing);
# - permission for Cloud Billing's budget service to publish to it;
# - a monthly budget for this project (default $25) with email alerts at 50%, 90%, 100%
#   and 300% of actual spend and 100% of forecast spend, publishing to the topic;
# - `solara-budget`, the service account only `budgetAlert` runs as: it may write the
#   cost guard (Firestore), write logs, receive the topic's events and, unless
#   DETACH_BILLING=false, detach the project from its billing account. No other Function
#   runs as it, so no bug in an HTTP endpoint can detach billing (finding L2). The deploy
#   identity may attach it to the Function, and nothing broader.
#
# Defaults, owner may change: a $25 budget; the cost guard at 100% and detaching billing
# at 300% (COST_GUARD_THRESHOLD_PERCENT and COST_GUARD_DETACH_THRESHOLD_PERCENT in
# functions/.env). Detaching stops the Functions; Hosting, sign-in and Firestore keep
# serving within the no-cost quotas.
#
# Afterwards, set the repository variables the script prints (BUDGET_ID and
# BUDGET_SERVICE_ACCOUNT) so the next deploy runs `budgetAlert` as that identity and acts
# only on this budget.
#
# Usage:
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX DEPLOY_SA=<deploy service account email> infra/budget.sh
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX DEPLOY_SA=<deploy service account email> infra/budget.sh --apply
# Options (environment): PROJECT_ID (default uv-activity-planner), BUDGET_AMOUNT
# (default 25USD), DETACH_BILLING (default true; false leaves out the billing role, and
# then also set the COST_GUARD_DETACH_BILLING repository variable to false).
# shellcheck source=infra/lib.sh
source "$(dirname "$0")/lib.sh"
require BILLING_ACCOUNT
require DEPLOY_SA
: "${BUDGET_AMOUNT:=25USD}"
: "${DETACH_BILLING:=true}"

TOPIC=budget-alerts
BUDGET_SA="solara-budget@${PROJECT_ID}.iam.gserviceaccount.com"

run gcloud services enable billingbudgets.googleapis.com cloudbilling.googleapis.com \
  pubsub.googleapis.com --project "$PROJECT_ID"
run gcloud pubsub topics create "$TOPIC" --project "$PROJECT_ID"
# Cloud Billing publishes budget notifications as this Google-managed account.
run gcloud pubsub topics add-iam-policy-binding "$TOPIC" --project "$PROJECT_ID" \
  --member serviceAccount:billing-budget-alert@system.gserviceaccount.com \
  --role roles/pubsub.publisher

BUDGET_ARGS=(
  --billing-account "$BILLING_ACCOUNT"
  --display-name "Solara monthly ($PROJECT_ID)"
  --budget-amount "$BUDGET_AMOUNT"
  --calendar-period month
  --filter-projects "projects/$PROJECT_ID"
  --threshold-rule percent=0.5
  --threshold-rule percent=0.9
  --threshold-rule percent=1.0
  --threshold-rule percent=3.0
  --threshold-rule "percent=1.0,basis=forecasted-spend"
  --notifications-rule-pubsub-topic "projects/$PROJECT_ID/topics/$TOPIC"
)
BUDGET_ID="<budget-id>"
if [ "$APPLY" = true ]; then
  BUDGET_NAME="$(gcloud billing budgets create "${BUDGET_ARGS[@]}" --format 'value(name)')"
  BUDGET_ID="${BUDGET_NAME##*/}"
else
  run gcloud billing budgets create "${BUDGET_ARGS[@]}"
fi

# budgetAlert's own identity.
run gcloud iam service-accounts create solara-budget \
  --project "$PROJECT_ID" --display-name "Solara budget kill switch (budgetAlert)"
ROLES=(roles/datastore.user roles/logging.logWriter roles/run.invoker roles/eventarc.eventReceiver)
if [ "$DETACH_BILLING" = true ]; then
  # Project Billing Manager on the project is enough to remove its billing account;
  # Google's guide ("Disable billing usage with notifications") grants Billing Account
  # Administrator on the billing account instead, which is broader.
  ROLES+=(roles/billing.projectManager)
fi
for role in "${ROLES[@]}"; do
  run gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${BUDGET_SA}" --role "$role" --condition None
done
run gcloud iam service-accounts add-iam-policy-binding "$BUDGET_SA" \
  --project "$PROJECT_ID" \
  --member "serviceAccount:${DEPLOY_SA}" --role roles/iam.serviceAccountUser

echo "Then set the repository variables and deploy:" >&2
echo "  gh variable set BUDGET_ID --repo n8watkins/solara --body $BUDGET_ID" >&2
echo "  gh variable set BUDGET_SERVICE_ACCOUNT --repo n8watkins/solara --body $BUDGET_SA" >&2
if [ "$DETACH_BILLING" != true ]; then
  echo "  gh variable set COST_GUARD_DETACH_BILLING --repo n8watkins/solara --body false" >&2
fi
