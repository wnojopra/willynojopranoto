#!/usr/bin/env bash
# Builds with Cloud Build and deploys Spirit Board to Cloud Run.
#
#   ./deploy.sh            # normal deploy (scales to zero when idle)
#   PARTY=1 ./deploy.sh    # party night: keep one instance warm all evening
set -euo pipefail

PROJECT="${PROJECT:-nojo-client}"
REGION="${REGION:-us-west1}"
SERVICE="${SERVICE:-spirit-board}"
MIN_INSTANCES=0
if [[ "${PARTY:-0}" == "1" ]]; then MIN_INSTANCES=1; fi

cd "$(dirname "$0")"

# Notes on flags:
# - max-instances=1: all game state is in memory, so every player must hit the
#   same instance.
# - session-affinity + 60 min timeout: keep long-lived WebSockets on it.
# - allow-unauthenticated: guests join from their phones without Google login.
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --source . \
  --allow-unauthenticated \
  --max-instances 1 \
  --min-instances "$MIN_INSTANCES" \
  --concurrency 200 \
  --session-affinity \
  --timeout 3600 \
  --cpu 1 \
  --memory 512Mi \
  --no-cpu-throttling \
  --quiet
