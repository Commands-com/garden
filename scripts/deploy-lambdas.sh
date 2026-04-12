#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# deploy-lambdas.sh - Package and deploy Lambda functions
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

Package and deploy Command Garden Lambda functions.

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

LAMBDA_DIR="$PROJECT_DIR/infra/lambda"

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
if ! command -v aws &>/dev/null; then
  echo -e "${RED}Error: AWS CLI is not installed.${NC}" >&2
  exit 1
fi

if [[ ! -d "$LAMBDA_DIR" ]]; then
  echo -e "${RED}Error: Lambda directory not found at $LAMBDA_DIR${NC}" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Lambda function names follow the pattern: ${STACK_NAME}-<function>
# ---------------------------------------------------------------------------
declare -A FUNCTION_MAP=(
  [feedback]="${STACK_NAME}-feedback"
  [reactions]="${STACK_NAME}-reactions"
  [health]="${STACK_NAME}-health"
  [game-scores]="${STACK_NAME}-game-scores"
)

FUNCTION_KEYS=(feedback reactions health game-scores)

echo -e "${YELLOW}Deploying Lambda functions for stack '${STACK_NAME}'...${NC}"
echo ""

FAILED=0
TOTAL=0
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

for FUNC_KEY in "${FUNCTION_KEYS[@]}"; do
  TOTAL=$((TOTAL + 1))
  FUNC_DIR="$LAMBDA_DIR/$FUNC_KEY"
  FUNC_NAME="${FUNCTION_MAP[$FUNC_KEY]}"
  ZIP_FILE="$TEMP_DIR/${FUNC_KEY}.zip"

  echo -e "${YELLOW}[$TOTAL/${#FUNCTION_KEYS[@]}] Deploying '${FUNC_KEY}' -> ${FUNC_NAME}${NC}"

  # Check function directory exists
  if [[ ! -d "$FUNC_DIR" ]]; then
    echo -e "${RED}  Error: Directory not found: $FUNC_DIR${NC}" >&2
    FAILED=$((FAILED + 1))
    continue
  fi

  # Package
  echo "  Packaging..."
  (cd "$FUNC_DIR" && zip -qr "$ZIP_FILE" .)
  ZIP_SIZE=$(ls -lh "$ZIP_FILE" | awk '{print $5}')
  echo "  Package size: $ZIP_SIZE"

  # Deploy
  echo "  Updating function code..."
  DEPLOY_EXIT=0
  aws lambda update-function-code \
    --function-name "$FUNC_NAME" \
    --zip-file "fileb://$ZIP_FILE" \
    "${AWS_FLAGS[@]}" \
    --output text \
    --query 'FunctionArn' 2>&1 || DEPLOY_EXIT=$?

  if [[ $DEPLOY_EXIT -ne 0 ]]; then
    echo -e "${RED}  Failed to deploy '${FUNC_KEY}'${NC}" >&2
    FAILED=$((FAILED + 1))
    continue
  fi

  # Wait for update to be ready
  echo "  Waiting for function to become active..."
  WAIT_EXIT=0
  aws lambda wait function-active-v2 \
    --function-name "$FUNC_NAME" \
    "${AWS_FLAGS[@]}" 2>&1 || WAIT_EXIT=$?

  if [[ $WAIT_EXIT -ne 0 ]]; then
    echo -e "${YELLOW}  Warning: Function may still be updating.${NC}"
  fi

  echo -e "${GREEN}  Successfully deployed '${FUNC_KEY}'${NC}"
  echo ""
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "---"
SUCCEEDED=$((TOTAL - FAILED))

if [[ $FAILED -eq 0 ]]; then
  echo -e "${GREEN}All ${TOTAL} Lambda functions deployed successfully.${NC}"
  exit 0
else
  echo -e "${RED}${FAILED} of ${TOTAL} deployments failed.${NC}"
  echo -e "${GREEN}${SUCCEEDED} of ${TOTAL} deployments succeeded.${NC}"
  exit 1
fi
