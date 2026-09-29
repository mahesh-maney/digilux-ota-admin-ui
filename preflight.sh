#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# preflight.sh — Validate deploy.config before building or deploying.
# Makes zero changes.  Exits 0 if all checks pass, 1 if anything fails.
#
# Usage:
#   ./preflight.sh
#   ./preflight.sh --config path/to.config
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
export AWS_PAGER="" PAGER=cat

DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Load config ───────────────────────────────────────────────────────────────
CONFIG_FILE="${DEPLOY_CONFIG:-${DIR}/deploy.config}"
[[ "$#" -ge 2 && "$1" == "--config" ]] && CONFIG_FILE="$2"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: $CONFIG_FILE not found."
  echo "       Copy deploy.config.template → deploy.config and fill in the values."
  exit 1
fi
set -a; source "$CONFIG_FILE"; set +a

# ── Colour helpers ────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  OK='\033[0;32m[  OK  ]\033[0m'
  FAIL='\033[0;31m[ FAIL ]\033[0m'
  WARN='\033[1;33m[ WARN ]\033[0m'
  SKIP='\033[0;34m[ SKIP ]\033[0m'
else
  OK='[  OK  ]'; FAIL='[ FAIL ]'; WARN='[ WARN ]'; SKIP='[ SKIP ]'
fi

ERRORS=0; WARNINGS=0
pass()  { echo -e "  ${OK}  $*"; }
fail()  { echo -e "  ${FAIL}  $*"; (( ERRORS++  )) || true; }
warn()  { echo -e "  ${WARN}  $*"; (( WARNINGS++ )) || true; }
skip()  { echo -e "  ${SKIP}  $*"; }
section() { echo ""; echo "── $* ──────────────────────────────────────────────────────"; }

# ── 1. Local tools ────────────────────────────────────────────────────────────
section "Local prerequisites"

for CMD in aws node npm; do
  if command -v "$CMD" &>/dev/null; then
    pass "$CMD  ($(command -v "$CMD"))"
  else
    fail "$CMD not found — install it before running deploy.sh"
  fi
done

# ── 2. Config values ──────────────────────────────────────────────────────────
section "deploy.config values"

check_set() {
  local VAR="$1" LABEL="$2"
  local VAL="${!VAR:-}"
  if [[ -z "$VAL" || "$VAL" == YOUR_* ]]; then
    fail "$LABEL ($VAR) is not set"
  else
    pass "$LABEL = $VAL"
  fi
}

check_set REGION       "AWS region"
check_set S3_BUCKET    "S3 bucket"
check_set API_BASE     "API base URL"
check_set COGNITO_URL  "Cognito URL"
check_set COGNITO_CLIENT "Cognito client ID"

# ── 3. AWS credentials ────────────────────────────────────────────────────────
section "AWS credentials"

CALLER_JSON=$(aws sts get-caller-identity --output json 2>&1) || {
  fail "AWS credentials not configured or expired: $CALLER_JSON"
  exit 1
}
CALLER_ACCOUNT=$(echo "$CALLER_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['Account'])")
CALLER_ARN=$(echo "$CALLER_JSON"     | python3 -c "import sys,json; print(json.load(sys.stdin)['Arn'])")
pass "AWS identity: $CALLER_ARN"
pass "Account     : $CALLER_ACCOUNT"

# ── 4. S3 bucket ──────────────────────────────────────────────────────────────
section "S3 bucket"

if aws s3api head-bucket --bucket "$S3_BUCKET" --region "$REGION" 2>/dev/null; then
  pass "s3://$S3_BUCKET exists and is accessible"

  # Check bucket has public access blocked OR is behind CloudFront
  BLOCK=$(aws s3api get-public-access-block \
    --bucket "$S3_BUCKET" --region "$REGION" 2>/dev/null \
    | python3 -c "
import sys,json
b = json.load(sys.stdin)['PublicAccessBlockConfiguration']
print(all(b.values()))
" 2>/dev/null || echo "False")
  if [[ "$BLOCK" == "True" ]]; then
    if [[ -n "${CLOUDFRONT_DIST_ID:-}" ]]; then
      pass "Public access blocked — served via CloudFront $CLOUDFRONT_DIST_ID"
    else
      warn "Public access is blocked on $S3_BUCKET but CLOUDFRONT_DIST_ID is not set."
      warn "  The bucket must be publicly accessible or served behind CloudFront."
      warn "  If this is a CloudFront + OAI/OAC setup, set CLOUDFRONT_DIST_ID."
    fi
  else
    pass "Bucket is publicly accessible (static website hosting)"
  fi
else
  fail "s3://$S3_BUCKET not found or not accessible — check S3_BUCKET and your IAM permissions"
fi

# ── 5. CloudFront (optional) ──────────────────────────────────────────────────
section "CloudFront"

if [[ -z "${CLOUDFRONT_DIST_ID:-}" ]]; then
  skip "CLOUDFRONT_DIST_ID not set — cache invalidation will be skipped after deploy"
else
  if aws cloudfront get-distribution \
       --id "$CLOUDFRONT_DIST_ID" 2>/dev/null | grep -q '"Id"'; then
    pass "CloudFront distribution $CLOUDFRONT_DIST_ID exists"
  else
    fail "CloudFront distribution '$CLOUDFRONT_DIST_ID' not found"
  fi
fi

# ── 6. API reachability ───────────────────────────────────────────────────────
section "API base URL"

# Strip trailing /api/v1 and do a simple HTTP check on the root
API_ROOT="${API_BASE%/api/v1}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 10 "${API_ROOT}/" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "000" ]]; then
  warn "API_BASE URL is not reachable: $API_BASE"
  warn "  This may be expected if the API requires auth on all paths."
  warn "  Verify the URL is correct before deploying."
elif [[ "$HTTP_CODE" == "403" || "$HTTP_CODE" == "401" || "$HTTP_CODE" == "200" ]]; then
  pass "API_BASE URL responded with HTTP $HTTP_CODE (reachable)"
else
  warn "API_BASE URL responded with HTTP $HTTP_CODE — double-check the URL"
fi

# ── 7. Logo file ──────────────────────────────────────────────────────────────
section "Branding"

if [[ -n "${LOGO_FILE:-}" ]]; then
  if [[ -f "$LOGO_FILE" ]]; then
    EXT="${LOGO_FILE##*.}"
    SIZE=$(wc -c < "$LOGO_FILE")
    pass "Logo file: $LOGO_FILE  (${EXT}, ${SIZE} bytes)"
    if [[ "$EXT" != "png" && "$EXT" != "svg" && "$EXT" != "jpg" && "$EXT" != "jpeg" ]]; then
      warn "Logo extension .$EXT is unusual — supported formats: .png .svg .jpg"
    fi
  else
    fail "LOGO_FILE not found: $LOGO_FILE"
  fi
else
  EXISTING="$DIR/public/brand-logo.png"
  if [[ -f "$EXISTING" ]]; then
    pass "Using existing public/brand-logo.png (LOGO_FILE not set)"
  else
    warn "public/brand-logo.png not found and LOGO_FILE not set — build will have a missing logo"
  fi
fi

pass "BRAND_NAME    = ${BRAND_NAME:-OTA Admin}"
pass "APP_SUBTITLE  = ${APP_SUBTITLE:-OTA Admin}"

# ── 8. Node / npm version ─────────────────────────────────────────────────────
section "Node.js version"

NODE_VER=$(node --version 2>/dev/null | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [[ "$NODE_MAJOR" -ge 18 ]]; then
  pass "Node.js v$NODE_VER (>= 18 required)"
else
  fail "Node.js v$NODE_VER is too old — upgrade to v18 or later"
fi

# ── 9. npm dependencies ───────────────────────────────────────────────────────
section "npm dependencies"

if [[ -d "$DIR/node_modules" ]]; then
  pass "node_modules exists"
else
  warn "node_modules not found — deploy.sh will run 'npm install' automatically"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════"
if [[ $ERRORS -gt 0 ]]; then
  echo -e "  \033[0;31mPREFLIGHT FAILED — $ERRORS error(s), $WARNINGS warning(s)\033[0m"
  echo ""
  echo "  Fix all FAIL items above before running ./deploy.sh"
  echo "════════════════════════════════════════════════════════════════"
  exit 1
elif [[ $WARNINGS -gt 0 ]]; then
  echo -e "  \033[1;33mPREFLIGHT PASSED with $WARNINGS warning(s)\033[0m"
  echo "  Review WARN items above, then run: ./deploy.sh"
  echo "════════════════════════════════════════════════════════════════"
  exit 0
else
  echo -e "  \033[0;32mPREFLIGHT PASSED — all checks OK\033[0m"
  echo "  Safe to run: ./deploy.sh"
  echo "════════════════════════════════════════════════════════════════"
  exit 0
fi
