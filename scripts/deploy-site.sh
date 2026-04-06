#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# deploy-site.sh - Sync static site to S3 and invalidate CloudFront
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Sync the Command Garden static site to S3 and invalidate CloudFront.

Options:
  --help    Show this help message

Environment variables (from .env):
  STACK_NAME      CloudFormation stack name (default: command-garden)
  AWS_REGION      AWS region (default: us-east-1)
  AWS_PROFILE     AWS CLI profile
EOF
  exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help)
      usage
      ;;
    *)
      echo -e "${RED}Error: Unknown option: $1${NC}" >&2
      usage
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Source .env
# ---------------------------------------------------------------------------
set -a
source "$PROJECT_DIR/.env" 2>/dev/null || true
set +a

STACK_NAME="${STACK_NAME:-command-garden}"
AWS_REGION="${AWS_REGION:-us-east-1}"

AWS_FLAGS=()
if [[ -n "${AWS_PROFILE:-}" ]]; then
  AWS_FLAGS+=(--profile "$AWS_PROFILE")
fi
AWS_FLAGS+=(--region "$AWS_REGION")

SITE_DIR="$PROJECT_DIR/site"

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
if ! command -v aws &>/dev/null; then
  echo -e "${RED}Error: AWS CLI is not installed.${NC}" >&2
  exit 1
fi

if [[ ! -d "$SITE_DIR" ]]; then
  echo -e "${RED}Error: Site directory not found at $SITE_DIR${NC}" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Get stack outputs
# ---------------------------------------------------------------------------
echo -e "${YELLOW}Fetching stack outputs from '${STACK_NAME}'...${NC}"

get_stack_output() {
  local key="$1"
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    "${AWS_FLAGS[@]}" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue" \
    --output text
}

BUCKET_NAME=$(get_stack_output "SiteBucketName")
DISTRIBUTION_ID=$(get_stack_output "CloudFrontDistributionId")
SITE_URL=$(get_stack_output "SiteUrl")

if [[ -z "$BUCKET_NAME" || "$BUCKET_NAME" == "None" ]]; then
  echo -e "${RED}Error: Could not get SiteBucketName from stack outputs.${NC}" >&2
  exit 1
fi

if [[ -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
  echo -e "${RED}Error: Could not get CloudFrontDistributionId from stack outputs.${NC}" >&2
  exit 1
fi

echo "  Bucket:       $BUCKET_NAME"
echo "  Distribution: $DISTRIBUTION_ID"
echo "  Site URL:     $SITE_URL"
echo ""

# ---------------------------------------------------------------------------
# Sync site to S3 (per content type for cache-control headers)
# ---------------------------------------------------------------------------
echo -e "${YELLOW}Syncing site to s3://${BUCKET_NAME}/...${NC}"

SYNC_FLAGS=(--delete --exclude '.DS_Store' --exclude '*.map')

# HTML files: short cache
echo "  Syncing HTML files (cache: 5 min)..."
aws s3 sync "$SITE_DIR" "s3://$BUCKET_NAME" \
  "${AWS_FLAGS[@]}" \
  "${SYNC_FLAGS[@]}" \
  --exclude '*' \
  --include '*.html' \
  --content-type 'text/html; charset=utf-8' \
  --cache-control 'max-age=300'

# CSS files
echo "  Syncing CSS files (cache: 1 hour)..."
aws s3 sync "$SITE_DIR" "s3://$BUCKET_NAME" \
  "${AWS_FLAGS[@]}" \
  "${SYNC_FLAGS[@]}" \
  --exclude '*' \
  --include '*.css' \
  --content-type 'text/css; charset=utf-8' \
  --cache-control 'max-age=3600'

# JavaScript files
echo "  Syncing JS files (cache: 1 hour)..."
aws s3 sync "$SITE_DIR" "s3://$BUCKET_NAME" \
  "${AWS_FLAGS[@]}" \
  "${SYNC_FLAGS[@]}" \
  --exclude '*' \
  --include '*.js' \
  --content-type 'application/javascript; charset=utf-8' \
  --cache-control 'max-age=3600'

# JSON files
echo "  Syncing JSON files (cache: 1 hour)..."
aws s3 sync "$SITE_DIR" "s3://$BUCKET_NAME" \
  "${AWS_FLAGS[@]}" \
  "${SYNC_FLAGS[@]}" \
  --exclude '*' \
  --include '*.json' \
  --content-type 'application/json; charset=utf-8' \
  --cache-control 'max-age=3600'

# Image files (PNG)
echo "  Syncing PNG images (cache: 24 hours)..."
aws s3 sync "$SITE_DIR" "s3://$BUCKET_NAME" \
  "${AWS_FLAGS[@]}" \
  "${SYNC_FLAGS[@]}" \
  --exclude '*' \
  --include '*.png' \
  --content-type 'image/png' \
  --cache-control 'max-age=86400'

# Image files (JPG/JPEG)
echo "  Syncing JPG images (cache: 24 hours)..."
aws s3 sync "$SITE_DIR" "s3://$BUCKET_NAME" \
  "${AWS_FLAGS[@]}" \
  "${SYNC_FLAGS[@]}" \
  --exclude '*' \
  --include '*.jpg' \
  --include '*.jpeg' \
  --content-type 'image/jpeg' \
  --cache-control 'max-age=86400'

# Image files (SVG)
echo "  Syncing SVG images (cache: 24 hours)..."
aws s3 sync "$SITE_DIR" "s3://$BUCKET_NAME" \
  "${AWS_FLAGS[@]}" \
  "${SYNC_FLAGS[@]}" \
  --exclude '*' \
  --include '*.svg' \
  --content-type 'image/svg+xml' \
  --cache-control 'max-age=86400'

# Image files (WebP)
echo "  Syncing WebP images (cache: 24 hours)..."
aws s3 sync "$SITE_DIR" "s3://$BUCKET_NAME" \
  "${AWS_FLAGS[@]}" \
  "${SYNC_FLAGS[@]}" \
  --exclude '*' \
  --include '*.webp' \
  --content-type 'image/webp' \
  --cache-control 'max-age=86400'

# ICO files
echo "  Syncing ICO files (cache: 24 hours)..."
aws s3 sync "$SITE_DIR" "s3://$BUCKET_NAME" \
  "${AWS_FLAGS[@]}" \
  "${SYNC_FLAGS[@]}" \
  --exclude '*' \
  --include '*.ico' \
  --content-type 'image/x-icon' \
  --cache-control 'max-age=86400'

# Remaining files (catch-all, no explicit content-type)
echo "  Syncing remaining files..."
aws s3 sync "$SITE_DIR" "s3://$BUCKET_NAME" \
  "${AWS_FLAGS[@]}" \
  "${SYNC_FLAGS[@]}" \
  --exclude '*.html' \
  --exclude '*.css' \
  --exclude '*.js' \
  --exclude '*.json' \
  --exclude '*.png' \
  --exclude '*.jpg' \
  --exclude '*.jpeg' \
  --exclude '*.svg' \
  --exclude '*.webp' \
  --exclude '*.ico' \
  --cache-control 'max-age=3600'

echo -e "${GREEN}S3 sync complete.${NC}"
echo ""

# ---------------------------------------------------------------------------
# Invalidate CloudFront
# ---------------------------------------------------------------------------
echo -e "${YELLOW}Creating CloudFront invalidation for '/*'...${NC}"

INVALIDATION_OUTPUT=$(aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths '/*' \
  "${AWS_FLAGS[@]}" \
  --output json)

INVALIDATION_ID=$(echo "$INVALIDATION_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['Invalidation']['Id'])")

echo "  Invalidation ID: $INVALIDATION_ID"
echo -e "${YELLOW}Waiting for invalidation to complete (timeout: 5 min)...${NC}"

TIMEOUT=300
ELAPSED=0
INTERVAL=10

while [[ $ELAPSED -lt $TIMEOUT ]]; do
  STATUS=$(aws cloudfront get-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --id "$INVALIDATION_ID" \
    "${AWS_FLAGS[@]}" \
    --query 'Invalidation.Status' \
    --output text)

  if [[ "$STATUS" == "Completed" ]]; then
    break
  fi

  echo "  Status: $STATUS (${ELAPSED}s elapsed)"
  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
done

if [[ "$STATUS" != "Completed" ]]; then
  echo -e "${YELLOW}Warning: Invalidation did not complete within ${TIMEOUT}s.${NC}"
  echo "  Invalidation ID $INVALIDATION_ID is still in progress."
  echo "  The site will update once CloudFront finishes propagating."
else
  echo -e "${GREEN}Invalidation complete.${NC}"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}Site deployed successfully!${NC}"
echo -e "${GREEN}URL: ${SITE_URL}${NC}"
