#!/usr/bin/env bash
# Deploys the four Hot Pizza Ace Edge functions to a Supabase project.
# Database migrations are NOT run here (apply them separately and on purpose).
# Run it yourself in Terminal; the Supabase CLI login happens in your browser.
set -euo pipefail
REF="${1:?Usage: scripts/deploy-edge-functions.sh <project-ref>}"
if [[ ! "$REF" =~ ^[a-z]{20}$ ]]; then echo "Not a project ref: $REF" >&2; exit 1; fi
cd "$(dirname "$0")/.."
SB="npx --yes supabase@3.0.0"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
read -r -p "Deploy Edge functions to project $REF? Type the ref again to confirm: " CONFIRM
[[ "$CONFIRM" == "$REF" ]] || { echo "Cancelled."; exit 1; }

$SB login
node scripts/bundle-commerce-edge.mjs "$TMP/bundles/hpa-commerce-edge-files.json"
node scripts/bundle-kitchen-edge.mjs "$TMP/bundles/hpa-kitchen-edge-files.json"
node scripts/prepare-edge-deploy.mjs "$TMP/bundles" "$TMP/work" "$REF"
# JWT verification stays off, matching the existing deployments: each function
# authenticates in its own code, and webhooks verify the provider's signature.
for fn in hpa-commerce hpa-kitchen hpa-razorpay-webhook hpa-phonepe-webhook; do
  $SB functions deploy "$fn" --project-ref "$REF" --workdir "$TMP/work" --no-verify-jwt --use-api
done
echo "Deployed. Next: set the PHONEPE_* secrets (docs/PHONEPE-PAYMENTS.md)."
