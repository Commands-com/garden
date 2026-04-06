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
LAMBDA_CODE_BUCKET="${LAMBDA_CODE_BUCKET:-}"
LAMBDA_CODE_VERSION="${LAMBDA_CODE_VERSION:-latest}"

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
# Package Lambda code to S3
#
# The CloudFormation template uses `!If HasLambdaCodeBucket` to switch between
# S3-based Lambda code (real handlers) and inline ZipFile placeholders.
# `aws cloudformation package` does NOT work here because the template uses
# conditional S3Bucket/S3Key references, not CodeUri local paths.
#
# Strategy:
#   - If a staging bucket exists (explicit LAMBDA_CODE_BUCKET, or the site
#     bucket already exists from a prior deploy), zip + upload Lambda code and
#     pass LambdaCodeBucket/LambdaCodeVersion as stack parameters.
#   - On first deploy (no bucket yet), skip Lambda upload — the stack creates
#     the site bucket with inline placeholders. Re-run the script afterward
#     to deploy real Lambda code.
# ---------------------------------------------------------------------------
LAMBDA_DIR="$PROJECT_DIR/infra/lambda"
DEPLOY_TEMPLATE="$TEMPLATE_PATH"

# Determine a staging bucket for Lambda uploads.
STAGING_BUCKET="${LAMBDA_CODE_BUCKET:-}"
if [[ -z "$STAGING_BUCKET" ]]; then
  # Check if the site bucket already exists (update path / second run)
  if aws s3api head-bucket --bucket "$SITE_BUCKET_NAME" ${AWS_FLAGS[@]+"${AWS_FLAGS[@]}"} 2>/dev/null; then
    STAGING_BUCKET="$SITE_BUCKET_NAME"
  fi
fi

LAMBDA_PARAMS_SET=false
if [[ -d "$LAMBDA_DIR" && -n "$STAGING_BUCKET" ]]; then
  echo -e "${YELLOW}Packaging Lambda functions to s3://${STAGING_BUCKET}/${LAMBDA_CODE_VERSION}/...${NC}"

  TEMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TEMP_DIR"' EXIT

  LAMBDA_UPLOAD_OK=true
  for FUNC_KEY in feedback reactions health; do
    FUNC_DIR="$LAMBDA_DIR/$FUNC_KEY"
    if [[ ! -d "$FUNC_DIR" ]]; then
      echo -e "${YELLOW}  Warning: Lambda directory not found for '${FUNC_KEY}' — skipping${NC}"
      LAMBDA_UPLOAD_OK=false
      continue
    fi

    ZIP_FILE="$TEMP_DIR/${FUNC_KEY}.zip"
    (cd "$FUNC_DIR" && zip -qr "$ZIP_FILE" .)

    S3_KEY="${LAMBDA_CODE_VERSION}/${FUNC_KEY}.zip"
    UPLOAD_EXIT=0
    aws s3 cp "$ZIP_FILE" "s3://${STAGING_BUCKET}/${S3_KEY}" \
      ${AWS_FLAGS[@]+"${AWS_FLAGS[@]}"} --quiet 2>&1 || UPLOAD_EXIT=$?

    if [[ $UPLOAD_EXIT -ne 0 ]]; then
      echo -e "${YELLOW}  Warning: Failed to upload ${FUNC_KEY}.zip to S3 — stack will use inline placeholder${NC}"
      LAMBDA_UPLOAD_OK=false
    else
      echo "  Uploaded ${FUNC_KEY}.zip ($(du -h "$ZIP_FILE" | cut -f1))"
    fi
  done

  if $LAMBDA_UPLOAD_OK; then
    LAMBDA_PARAMS_SET=true
    LAMBDA_CODE_BUCKET="$STAGING_BUCKET"
    echo -e "${GREEN}Lambda packages uploaded successfully.${NC}"
  else
    echo -e "${YELLOW}Some Lambda packages failed to upload — stack will use inline placeholders.${NC}"
    echo -e "${YELLOW}Run this script again after fixing the issue to deploy real Lambda code.${NC}"
  fi
  echo ""
elif [[ -d "$LAMBDA_DIR" ]]; then
  echo -e "${YELLOW}No staging bucket available (first deploy?) — stack will use inline Lambda placeholders.${NC}"
  echo -e "${YELLOW}After the stack creates the site bucket, re-run this script to deploy real Lambda code.${NC}"
  echo ""
else
  echo -e "${YELLOW}No Lambda source directory found — stack will use inline placeholders.${NC}"
  echo ""
fi

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

# Build the common parameters array. Lambda params are only added when
# we successfully uploaded Lambda ZIPs to S3 above.
PARAMS=(
  "ParameterKey=Environment,ParameterValue=$ENVIRONMENT"
  "ParameterKey=SiteBucketName,ParameterValue=$SITE_BUCKET_NAME"
  "ParameterKey=TablePrefix,ParameterValue=$DYNAMO_TABLE_PREFIX"
)
if $LAMBDA_PARAMS_SET; then
  PARAMS+=(
    "ParameterKey=LambdaCodeBucket,ParameterValue=$LAMBDA_CODE_BUCKET"
    "ParameterKey=LambdaCodeVersion,ParameterValue=$LAMBDA_CODE_VERSION"
  )
fi

if $STACK_EXISTS; then
  echo "Stack exists. Running update..."

  UPDATE_OUTPUT=""
  UPDATE_EXIT=0
  UPDATE_OUTPUT=$(aws cloudformation update-stack \
    --stack-name "$STACK_NAME" \
    --template-body "file://$DEPLOY_TEMPLATE" \
    --parameters "${PARAMS[@]}" \
    --capabilities CAPABILITY_IAM \
    ${AWS_FLAGS[@]+"${AWS_FLAGS[@]}"} 2>&1) || UPDATE_EXIT=$?

  if [[ $UPDATE_EXIT -ne 0 ]]; then
    if echo "$UPDATE_OUTPUT" | grep -q "No updates are to be performed"; then
      echo -e "${GREEN}No updates are to be performed. Stack is already up to date.${NC}"
      echo ""
      echo -e "${GREEN}Current stack outputs:${NC}"
      aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        ${AWS_FLAGS[@]+"${AWS_FLAGS[@]}"} \
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
    --template-body "file://$DEPLOY_TEMPLATE" \
    --parameters "${PARAMS[@]}" \
    --capabilities CAPABILITY_IAM \
    ${AWS_FLAGS[@]+"${AWS_FLAGS[@]}"}

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
