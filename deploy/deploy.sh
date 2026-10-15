#!/usr/bin/env bash
# Build + deploy backend & frontend to Cloud Run.
# Usage: PROJECT_ID=.. REGION=asia-northeast1 ./deploy/deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-asia-northeast1}"
VERTEX_LOCATION="${VERTEX_LOCATION:-us-central1}"
SA="deadlinepilot-run@${PROJECT_ID}.iam.gserviceaccount.com"
AR="${REGION}-docker.pkg.dev/${PROJECT_ID}/deadlinepilot"
TAG="${TAG:-$(date +%Y%m%d-%H%M%S)}"

cd "$(dirname "$0")/.."

echo "== build & push backend =="
gcloud builds submit backend --tag "${AR}/backend:${TAG}" --project "$PROJECT_ID"
echo "== build & push frontend =="
gcloud builds submit frontend --tag "${AR}/frontend:${TAG}" --project "$PROJECT_ID"

echo "== cron token for Cloud Scheduler (created once) =="
gcloud services enable cloudscheduler.googleapis.com --project "$PROJECT_ID" >/dev/null
if ! gcloud secrets describe cron-token --project "$PROJECT_ID" >/dev/null 2>&1; then
  openssl rand -hex 24 | tr -d '\n' | gcloud secrets create cron-token \
    --data-file=- --replication-policy=automatic --project "$PROJECT_ID"
fi

# The API's own URL (stable per service) -- lets the watcher crawl the demo
# organizer page served by the API itself.
BACKEND_URL=$(gcloud run services describe deadlinepilot-api \
  --region "$REGION" --project "$PROJECT_ID" --format 'value(status.url)' 2>/dev/null || true)

echo "== deploy backend =="
gcloud run deploy deadlinepilot-api \
  --image "${AR}/backend:${TAG}" \
  --region "$REGION" --project "$PROJECT_ID" \
  --service-account "$SA" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 5 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${VERTEX_LOCATION},GOOGLE_GENAI_USE_VERTEXAI=true,USE_FIRESTORE=true,SEED_DEMO=true,RESET_DEMO=${TAG},PUBLIC_BASE_URL=${BACKEND_URL}" \
  --set-secrets "SESSION_SECRET=session-secret:latest,JUDGE_PASSWORD=judge-password:latest,CRON_TOKEN=cron-token:latest"

BACKEND_URL=$(gcloud run services describe deadlinepilot-api \
  --region "$REGION" --project "$PROJECT_ID" --format 'value(status.url)')
echo "backend: $BACKEND_URL"

echo "== Cloud Scheduler: crawl registered URLs every 6 hours =="
CRON_TOKEN=$(gcloud secrets versions access latest --secret cron-token --project "$PROJECT_ID")
JOB_ARGS=(--location "$REGION" --project "$PROJECT_ID"
  --schedule "0 */6 * * *" --time-zone "Asia/Tokyo"
  --uri "${BACKEND_URL}/api/cron/watch" --http-method POST
  --attempt-deadline 300s)
if gcloud scheduler jobs describe deadlinepilot-watch --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud scheduler jobs update http deadlinepilot-watch "${JOB_ARGS[@]}" \
    --update-headers "X-Cron-Token=${CRON_TOKEN}" >/dev/null
else
  gcloud scheduler jobs create http deadlinepilot-watch "${JOB_ARGS[@]}" \
    --headers "X-Cron-Token=${CRON_TOKEN}" >/dev/null
fi

echo "== deploy frontend =="
gcloud run deploy deadlinepilot-web \
  --image "${AR}/frontend:${TAG}" \
  --region "$REGION" --project "$PROJECT_ID" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 3 \
  --set-env-vars "BACKEND_URL=${BACKEND_URL}"

FRONTEND_URL=$(gcloud run services describe deadlinepilot-web \
  --region "$REGION" --project "$PROJECT_ID" --format 'value(status.url)')
echo "== DONE =="
echo "frontend: $FRONTEND_URL"
echo "backend : $BACKEND_URL"
