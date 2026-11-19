#!/usr/bin/env bash
# Idempotently configures:
#   1) A monthly GCP Billing Budget alert for the Cloud Run project ($10/mo default,
#      alerting at 50%, 90%, 100% actual spend + 100% forecasted spend).
#   2) (Optional, if ALERT_EMAIL is set) A Cloud Monitoring alert firing when
#      simultaneous connections on `spirit-board` exceed CONCURRENCY_THRESHOLD (default 50).
#
# Usage:
#   ./scripts/setup-alerts.sh
#   ALERT_EMAIL="you@example.com" BUDGET_USD=10 ./scripts/setup-alerts.sh
set -euo pipefail

PROJECT="${PROJECT:-nojo-client}"
SERVICE="${SERVICE:-spirit-board}"
BUDGET_USD="${BUDGET_USD:-10}"
BUDGET_NAME="${BUDGET_NAME:-${PROJECT}-monthly-budget}"
CONCURRENCY_THRESHOLD="${CONCURRENCY_THRESHOLD:-50}"
ALERT_EMAIL="${ALERT_EMAIL:-}"

echo "Resolving billing account for project '${PROJECT}'..."
BILLING_ACCOUNT="$(gcloud billing projects describe "$PROJECT" --format='value(billingAccountName.basename())')"
if [[ -z "$BILLING_ACCOUNT" ]]; then
  echo "Error: No billing account linked to project '${PROJECT}' (or missing permissions)." >&2
  exit 1
fi
echo "Billing account: ${BILLING_ACCOUNT}"

gcloud services enable billingbudgets.googleapis.com monitoring.googleapis.com --project="$PROJECT" --quiet

EXISTING_BUDGET="$(
  gcloud billing budgets list \
    --billing-account="$BILLING_ACCOUNT" \
    --filter="displayName=\"${BUDGET_NAME}\"" \
    --format='value(name)'
)"

CHANNEL_ARGS=()
CHANNEL_ID=""

if [[ -n "$ALERT_EMAIL" ]]; then
  EXISTING_CHANNEL="$(
    gcloud alpha monitoring channels list \
      --project="$PROJECT" \
      --filter="type=\"email\" AND labels.email_address=\"${ALERT_EMAIL}\"" \
      --format='value(name)' | head -n 1
  )"
  if [[ -n "$EXISTING_CHANNEL" ]]; then
    CHANNEL_ID="$EXISTING_CHANNEL"
    echo "Using existing email notification channel: ${CHANNEL_ID}"
  else
    echo "Creating email notification channel for ${ALERT_EMAIL}..."
    CHANNEL_ID="$(
      gcloud alpha monitoring channels create \
        --project="$PROJECT" \
        --display-name="Party Games Alerts (${ALERT_EMAIL})" \
        --type=email \
        --channel-labels="email_address=${ALERT_EMAIL}" \
        --format='value(name)'
    )"
    echo "Created notification channel: ${CHANNEL_ID}"
  fi
  CHANNEL_ARGS=("--notifications-rule-monitoring-notification-channels=${CHANNEL_ID}")
fi

if [[ -n "$EXISTING_BUDGET" ]]; then
  echo "Billing budget '${BUDGET_NAME}' already exists (${EXISTING_BUDGET}); skipping create."
else
  echo "Creating \$${BUDGET_USD}/month billing budget '${BUDGET_NAME}'..."
  gcloud billing budgets create \
    --billing-account="$BILLING_ACCOUNT" \
    --display-name="$BUDGET_NAME" \
    --budget-amount="${BUDGET_USD}USD" \
    --calendar-period=month \
    --filter-projects="projects/${PROJECT}" \
    --threshold-rule=percent=0.5,basis=current-spend \
    --threshold-rule=percent=0.9,basis=current-spend \
    --threshold-rule=percent=1.0,basis=current-spend \
    --threshold-rule=percent=1.0,basis=forecasted-spend \
    "${CHANNEL_ARGS[@]}"
  echo "Billing budget created. (Note: GCP budgets send alert emails; --max-instances=1 caps compute.)"
fi

if [[ -n "$CHANNEL_ID" ]]; then
  POLICY_NAME="${SERVICE}-high-concurrency"
  EXISTING_POLICY="$(
    gcloud alpha monitoring policies list \
      --project="$PROJECT" \
      --filter="displayName=\"${POLICY_NAME}\"" \
      --format='value(name)' | head -n 1
  )"
  if [[ -n "$EXISTING_POLICY" ]]; then
    echo "Monitoring alert policy '${POLICY_NAME}' already exists (${EXISTING_POLICY}); skipping."
  else
    echo "Creating Cloud Monitoring concurrency spike alert (>${CONCURRENCY_THRESHOLD} concurrent connections)..."
    TMP_POLICY="$(mktemp)"
    trap 'rm -f "$TMP_POLICY"' EXIT
    cat >"$TMP_POLICY" <<EOF
{
  "displayName": "${POLICY_NAME}",
  "combiner": "OR",
  "notificationChannels": ["${CHANNEL_ID}"],
  "conditions": [
    {
      "displayName": "Cloud Run concurrent requests > ${CONCURRENCY_THRESHOLD}",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${SERVICE}\" AND metric.type = \"run.googleapis.com/container/max_request_concurrencies\"",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_MAX"
          }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": ${CONCURRENCY_THRESHOLD},
        "duration": "300s",
        "trigger": { "count": 1 }
      }
    }
  ]
}
EOF
    gcloud alpha monitoring policies create \
      --project="$PROJECT" \
      --policy-from-file="$TMP_POLICY"
    echo "Concurrency spike alert created."
  fi
else
  echo "Tip: re-run with ALERT_EMAIL=\"you@example.com\" ./scripts/setup-alerts.sh to also add a Cloud Run traffic-spike alert."
fi
