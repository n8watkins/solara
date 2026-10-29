#!/usr/bin/env bash
# Cloud Logging exclusions that keep secrets out of the logs and keep a request flood
# from turning into a logging bill (finding H1; docs/DEPLOYMENT.md, "Cost and abuse
# limits" and "Keep feed tokens out of request logs").
#
# Adds two exclusions to the project's _Default sink:
# - calendar-feed-requests: every request log of the calendar feed, whose URL carries a
#   working feed token;
# - rejected-requests-sample: 99% of the Cloud Run request logs of any Function that
#   answered 4xx (App Check missing, rate limited, wrong method). One in a hundred is
#   kept to show the pattern; the Functions' own logs summarize rejections once a
#   minute (functions/src/shared/log-throttle.ts). 5xx and successful requests are kept.
#
# Excluded entries are never stored, so they are neither billed nor readable later.
#
# Usage:
#   infra/logging.sh           # print the commands
#   infra/logging.sh --apply   # run them
# Options (environment): PROJECT_ID (default uv-activity-planner), FEED_SERVICE (the
# feed's Cloud Run service name, default calendarfeed; Functions v2 lowercases it).
# shellcheck source=infra/lib.sh
source "$(dirname "$0")/lib.sh"
: "${FEED_SERVICE:=calendarfeed}"

FEED_FILTER="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$FEED_SERVICE\" AND log_id(\"run.googleapis.com/requests\")"
REJECTED_FILTER='resource.type="cloud_run_revision" AND log_id("run.googleapis.com/requests") AND httpRequest.status>=400 AND httpRequest.status<500 AND sample(insertId, 0.99)'

# `^;^` makes `;` the separator between the exclusion's fields, because the filters
# contain commas.
run gcloud logging sinks update _Default --project "$PROJECT_ID" \
  --add-exclusion "^;^name=calendar-feed-requests;filter=$FEED_FILTER"
run gcloud logging sinks update _Default --project "$PROJECT_ID" \
  --add-exclusion "^;^name=rejected-requests-sample;filter=$REJECTED_FILTER"
