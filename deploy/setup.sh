#!/usr/bin/env bash
# One-time GCP setup for DeadlinePilot.
# Usage: PROJECT_ID=your-project REGION=asia-northeast1 ./deploy/setup.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-asia-northeast1}"
VERTEX_LOCATION="${VERTEX_LOCATION:-us-central1}"
SA_NAME="deadlinepilot-run"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "== project: $PROJECT_ID / region: $REGION =="
gcloud config set project "$PROJECT_ID"

echo "== enabling APIs =="
gcloud services enable \
  run.googleapis.com \
  aiplatform.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  logging.googleapis.com \
  cloudtrace.googleapis.com \
  --project "$PROJECT_ID"

echo "== Firestore (Native mode) =="
gcloud firestore databases create --location="$REGION" --project="$PROJECT_ID" || true

echo "== service account =="
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="DeadlinePilot runtime" --project="$PROJECT_ID" || true

for role in roles/datastore.user roles/aiplatform.user \
            roles/secretmanager.secretAccessor roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA" --role="$role" --quiet >/dev/null
done

echo "== secrets =="
# SESSION_SECRET: random if not provided
: "${SESSION_SECRET:=$(openssl rand -hex 32)}"
: "${JUDGE_PASSWORD:?set JUDGE_PASSWORD for the demo account}"
printf '%s' "$SESSION_SECRET" | gcloud secrets create session-secret \
  --data-file=- --project="$PROJECT_ID" --replication-policy=automatic || \
  printf '%s' "$SESSION_SECRET" | gcloud secrets versions add session-secret --data-file=- --project="$PROJECT_ID"
printf '%s' "$JUDGE_PASSWORD" | gcloud secrets create judge-password \
  --data-file=- --project="$PROJECT_ID" --replication-policy=automatic || \
  printf '%s' "$JUDGE_PASSWORD" | gcloud secrets versions add judge-password --data-file=- --project="$PROJECT_ID"

echo "== artifact registry =="
gcloud artifacts repositories create deadlinepilot \
  --repository-format=docker --location="$REGION" \
  --project="$PROJECT_ID" || true

echo "DONE. Now run ./deploy/deploy.sh"
