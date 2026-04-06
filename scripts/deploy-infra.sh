#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# deploy-infra.sh - Deploy Command Garden CloudFormation stack
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Defaults
ENVIRONMENT="dev"

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Deploy the Command Garden CloudFormation infrastructure stack.

Options:
  --env ENV    Target environment: dev, staging, prod (default: dev)
  --help       Show this help message

Environment variables (from .env):
  STACK_NAME            CloudFormation stack name (default: command-garden)
  SITE_BUCKET_NAME      S3 bucket name for site content
  DYNAMO_TABLE_PREFIX   DynamoDB table name prefix (default: command-garden)
  AWS_REGION            AWS region (default: us-east-1)
  AWS_PROFILE           AWS CLI profile
EOF
  exit 0
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENVIRONMENT="$2"
      shift 2
      ;;
    --help)
      usage
      ;;
    *)
      echo -e "${RED}Error: Unknown option: $1${NC}" >&2
      usage
      ;;
  esac
done

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
  echo -e "${RED}Error: Invalid environment '$ENVIRONMENT'. Must be dev, staging, or prod.${NC}" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Source .env
# ---------------------------------------------------------------------------
set -a
source "$PROJECT_DIR/.env" 2>/dev/null || true
set +a

# Defaults for variables that may not be in .env
STACK_NAME="${STACK_NAME:-command-garden}"
SITE_BUCKET_NAME="${SITE_BUCKET_NAME:-command-garden-site}"
DYNAMO_TABLE_PREFIX="${DYNAMO_TABLE_PREFIX:-command-garden}"
AWS_REGION="${AWS_REGION:-us-east-1}"

# Build AWS CLI flags
AWS_FLAGS=()
if [[ -n "${AWS_PROFILE:-}" ]]; then
  AWS_FLAGS+=(--profile "$AWS_PROFILE")
fi
AWS_FLAGS+=(--region "$AWS_REGION")

TEMPLATE_PATH="$PROJECT_DIR/infra/cloudformation.yaml"

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
echo -e "${YELLOW}Preflight checks...${NC}"

if ! command -v aws &>/dev/null; then
  echo -e "${RED}Error: AWS CLI is not installed. Install it from https://aws.amazon.com/cli/${NC}" >&2
  exit 1
fi

if ! aws sts get-caller-identity "${AWS_FLAGS[@]}" &>/dev/null; then
  echo -e "${RED}Error: AWS CLI is not configured or credentials are invalid.${NC}" >&2
  exit 1
fi

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo -e "${RED}Error: CloudFormation template not found at $TEMPLATE_PATH${NC}" >&2
  exit 1
fi

echo -e "${GREEN}AWS CLI configured. Identity:${NC}"
aws sts get-caller-identity "${AWS_FLAGS[@]}" --output table

# ---------------------------------------------------------------------------
# Determine create vs update
# ---------------------------------------------------------------------------
echo ""
echo -e "${YELLOW}Deploying stack '${STACK_NAME}' to environment '${ENVIRONMENT}' in ${AWS_REGION}...${NC}"

STACK_EXISTS=false
if aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    "${AWS_FLAGS[@]}" &>/dev/null; then
  STACK_EXISTS=true
fi

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------
WAIT_ACTION=""

if $STACK_EXISTS; then
  echo "Stack exists. Running update..."

  UPDATE_OUTPUT=""
  UPDATE_EXIT=0
  UPDATE_OUTPUT=$(aws cloudformation update-stack \
    --stack-name "$STACK_NAME" \
    --template-body "file://$TEMPLATE_PATH" \
    --parameters \
      "ParameterKey=Environment,ParameterValue=$ENVIRONMENT" \
      "ParameterKey=SiteBucketName,ParameterValue=$SITE_BUCKET_NAME" \
      "ParameterKey=TablePrefix,ParameterValue=$DYNAMO_TABLE_PREFIX" \
    --capabilities CAPABILITY_IAM \
    "${AWS_FLAGS[@]}" 2>&1) || UPDATE_EXIT=$?

  if [[ $UPDATE_EXIT -ne 0 ]]; then
    if echo "$UPDATE_OUTPUT" | grep -q "No updates are to be performed"; then
      echo -e "${GREEN}No updates are to be performed. Stack is already up to date.${NC}"
      echo ""
      echo -e "${GREEN}Current stack outputs:${NC}"
      aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        "${AWS_FLAGS[@]}" \
        --query 'Stacks[0].Outputs' \
        --output table
      exit 0
    else
      echo -e "${RED}Error updating stack:${NC}" >&2
      echo "$UPDATE_OUTPUT" >&2
      exit 1
    fi
  fi

  WAIT_ACTION="stack-update-complete"
else
  echo "Stack does not exist. Creating..."

  aws cloudformation create-stack \
    --stack-name "$STACK_NAME" \
    --template-body "file://$TEMPLATE_PATH" \
    --parameters \
      "ParameterKey=Environment,ParameterValue=$ENVIRONMENT" \
      "ParameterKey=SiteBucketName,ParameterValue=$SITE_BUCKET_NAME" \
      "ParameterKey=TablePrefix,ParameterValue=$DYNAMO_TABLE_PREFIX" \
    --capabilities CAPABILITY_IAM \
    "${AWS_FLAGS[@]}"

  WAIT_ACTION="stack-create-complete"
fi

# ---------------------------------------------------------------------------
# Wait for completion
# ---------------------------------------------------------------------------
echo ""
echo -e "${YELLOW}Waiting for ${WAIT_ACTION}...${NC}"
echo "(This may take several minutes)"

WAIT_EXIT=0
aws cloudformation wait "$WAIT_ACTION" \
  --stack-name "$STACK_NAME" \
  "${AWS_FLAGS[@]}" || WAIT_EXIT=$?

if [[ $WAIT_EXIT -ne 0 ]]; then
  echo -e "${RED}Stack deployment failed!${NC}" >&2
  echo ""
  echo -e "${RED}Recent stack events:${NC}" >&2
  aws cloudformation describe-stack-events \
    --stack-name "$STACK_NAME" \
    "${AWS_FLAGS[@]}" \
    --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`].[Timestamp,LogicalResourceId,ResourceStatusReason]' \
    --output table >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Success
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}Stack '${STACK_NAME}' deployed successfully!${NC}"
echo ""
echo -e "${GREEN}Stack outputs:${NC}"
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  "${AWS_FLAGS[@]}" \
  --query 'Stacks[0].Outputs' \
  --output table
