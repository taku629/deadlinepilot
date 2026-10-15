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

echo "== deploy backend =="
gcloud run deploy deadlinepilot-api \
  --image "${AR}/backend:${TAG}" \
  --region "$REGION" --project "$PROJECT_ID" \
  --service-account "$SA" \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 5 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${VERTEX_LOCATION},GOOGLE_GENAI_USE_VERTEXAI=true,USE_FIRESTORE=true,SEED_DEMO=true,RESET_DEMO=${TAG}" \
  --set-secrets "SESSION_SECRET=session-secret:latest,JUDGE_PASSWORD=judge-password:latest"

BACKEND_URL=$(gcloud run services describe deadlinepilot-api \
  --region "$REGION" --project "$PROJECT_ID" --format 'value(status.url)')
echo "backend: $BACKEND_URL"

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
