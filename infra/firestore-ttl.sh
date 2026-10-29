#!/usr/bin/env bash
# Firestore TTL policies: Firestore deletes a document some time (usually within a day)
# after the timestamp in its `expireAt` field passes. TTL deletes need the Blaze plan.
#
# The Functions write `expireAt` on every server-owned bookkeeping record
# (functions/src/shared/ttl.ts), and the app writes it on every scheduled activity
# (packages/core/src/scheduled.ts) and imported event (packages/core/src/events.ts), so
# accounts that never come back are cleaned up too.
# firestore.indexes.json exempts `expireAt` from indexing in the same collection groups,
# as Google recommends for TTL fields; it leaves the TTL setting itself alone, so index
# deploys never turn these policies off.
#
# | Collection group               | Expires                                       |
# | ------------------------------ | --------------------------------------------- |
# | stripeWebhookEvents            | 90 days after the event was processed         |
# | stripeCheckoutCleanupTasks     | 30 days after the cleanup finished            |
# | accountDeletionTombstones      | 90 days after the deletion finished           |
# | billingCleanupResources        | 90 days after the resource was cleaned up     |
# | stripeSubscriptionOwners       | 90 days after its account's deletion finished |
# | notificationRegistrationLimits | 1 day after the rate-limit window             |
# | scheduled                      | 30 days after the scheduled event ends        |
# | events                         | 30 days after the imported event ends         |
# | forecastCache                  | 1 day after the forecast was fetched          |
# | forecastUpstream               | 2 days after the counter's hour or day        |
# | alertState                     | 7 days after the last alert was claimed       |
# | trialHistory                   | 2 years after the trial it records            |
#
# Usage: infra/firestore-ttl.sh (prints the commands), then infra/firestore-ttl.sh --apply
# Check with: gcloud firestore fields ttls list --project uv-activity-planner
# shellcheck source=infra/lib.sh
source "$(dirname "$0")/lib.sh"

for group in stripeWebhookEvents stripeCheckoutCleanupTasks accountDeletionTombstones \
  billingCleanupResources stripeSubscriptionOwners notificationRegistrationLimits scheduled \
  events forecastCache forecastUpstream alertState trialHistory; do
  run gcloud firestore fields ttls update expireAt \
    --collection-group "$group" --enable-ttl --async --project "$PROJECT_ID"
done
