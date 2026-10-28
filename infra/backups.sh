#!/usr/bin/env bash
# Firestore recovery and Functions image cleanup (roadmap item 11; docs/RUNBOOK.md,
# "Backups and restore").
#
# Turns on, for the (default) database:
# - point-in-time recovery: any minute of the last 7 days can be read back;
# - delete protection: the database cannot be deleted until this is turned off;
# - a daily backup kept for 14 days.
# And sets the Artifact Registry cleanup policy for the Functions' container images
# (keep 1 day), so old images do not accumulate past the 0.5 GB free storage. The deploy
# workflow passes --force, which sets the same policy if it is missing.
#
# Cost: PITR and backup storage have no free quota but bill by size; for a database
# under 1 GiB both stay under a few cents a month (docs/COSTS.md).
#
# Usage: infra/backups.sh (prints the commands), then infra/backups.sh --apply
source "$(dirname "$0")/lib.sh"
: "${REGION:=us-central1}"

run gcloud firestore databases update --database '(default)' --project "$PROJECT_ID" \
  --enable-pitr
run gcloud firestore databases update --database '(default)' --project "$PROJECT_ID" \
  --delete-protection
run gcloud firestore backups schedules create --database '(default)' --project "$PROJECT_ID" \
  --recurrence daily --retention 14d
run npx firebase functions:artifacts:setpolicy --project "$PROJECT_ID" \
  --location "$REGION" --days 1 --force
