#!/usr/bin/env bash
# A test budget notification for the budget kill switch (`budgetAlert`,
# functions/src/ops/budget.ts; docs/RUNBOOK.md, "Budget kill switch"), published to the
# `budget-alerts` topic in the shape Cloud Billing uses, so the owner can see the guard
# act on Blaze without spending anything.
#
# The message carries BUDGET_ID (so the guard accepts it) and a budget period that
# started 40 days ago, so a test can never touch the current period:
# - PERCENT=50 (the default): the guard logs one WARNING ("budget passed its warning
#   level");
# - PERCENT=100: it engages the cost guard for that past period and logs an ERROR ("cost
#   guard engaged by the budget"), which also tests the error-log alert email; the past
#   period has already ended, so nothing is actually switched off;
# - PERCENT=300 or more (the detach level): it DETACHES BILLING for real, unless
#   COST_GUARD_DETACH_BILLING is false. The script refuses this unless DETACH_TEST=true;
#   do it only on a test project (docs/PLAN.md, Phase 6: the kill switch at a tiny budget).
# A test changes nothing while the cost guard document already records a later (real)
# period, so it cannot end a guard a real budget engaged. Running it again later in the
# same period may log nothing new for 50% (one warning per period).
#
# Afterwards, read what the guard did (the script prints the command):
#   gcloud logging read '<budgetAlert logs>' --freshness 15m
# and expect "budgetAlert processed" with the actions above.
#
# Usage:
#   BUDGET_ID=<budget id> infra/budget-dry-run.sh                 # print the message
#   BUDGET_ID=<budget id> infra/budget-dry-run.sh --apply         # publish it
#   PERCENT=100 BUDGET_ID=<budget id> infra/budget-dry-run.sh --apply
# Options (environment): PROJECT_ID (default uv-activity-planner), PERCENT (default 50),
# BUDGET_AMOUNT (default 25, the budget infra/budget.sh creates), DETACH_PERCENT
# (default 300, COST_GUARD_DETACH_THRESHOLD_PERCENT), DETACH_TEST (default false).
# shellcheck source=infra/lib.sh
source "$(dirname "$0")/lib.sh"
require BUDGET_ID
: "${PERCENT:=50}"
: "${BUDGET_AMOUNT:=25}"
: "${DETACH_PERCENT:=300}"
: "${DETACH_TEST:=false}"

for name in PERCENT BUDGET_AMOUNT DETACH_PERCENT; do
  if ! [[ "${!name}" =~ ^[0-9]+$ ]] || [ "${!name}" -gt 100000 ]; then
    echo "$name must be a whole number, not '${!name}'." >&2
    exit 2
  fi
done
if [ "$BUDGET_AMOUNT" -eq 0 ]; then
  echo "BUDGET_AMOUNT must be more than 0." >&2
  exit 2
fi
if [ "$PERCENT" -ge "$DETACH_PERCENT" ] && [ "$DETACH_TEST" != true ]; then
  echo "PERCENT=$PERCENT reaches the detach level ($DETACH_PERCENT%): budgetAlert would detach" >&2
  echo "$PROJECT_ID from its billing account for real. Only on a test project, run again" >&2
  echo "with DETACH_TEST=true." >&2
  exit 2
fi

# 40 days ago is always before the current monthly period (GNU date, then BSD date).
INTERVAL_START="$(date -u -d '40 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null ||
  date -u -v-40d +%Y-%m-%dT%H:%M:%SZ)"
COST_AMOUNT="$(awk -v amount="$BUDGET_AMOUNT" -v percent="$PERCENT" \
  'BEGIN { printf "%.2f", amount * percent / 100 }')"
MESSAGE="$(printf '{"budgetDisplayName":"Solara dry run","alertThresholdExceeded":%s,"costAmount":%s,"costIntervalStart":"%s","budgetAmount":%s,"budgetAmountType":"SPECIFIED_AMOUNT","currencyCode":"USD"}' \
  "$(awk -v percent="$PERCENT" 'BEGIN { printf "%.2f", percent / 100 }')" \
  "$COST_AMOUNT" "$INTERVAL_START" "$BUDGET_AMOUNT")"

run gcloud pubsub topics publish budget-alerts --project "$PROJECT_ID" \
  --message "$MESSAGE" \
  --attribute "budgetId=${BUDGET_ID##*/},billingAccountId=dry-run,schemaVersion=1.0"

echo "Then read what budgetAlert did (allow a minute):" >&2
printf '  gcloud logging read %q --project %q --freshness 15m --limit 20 --format %q\n' \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="budgetalert"' \
  "$PROJECT_ID" 'table(timestamp,severity,jsonPayload.message)' >&2
