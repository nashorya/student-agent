#!/usr/bin/env bash
set -euo pipefail

mkdir -p audit
printf 'attempt\n' >> audit/legacy-route-attempts.log
echo "Checking legacy recovery helper..."
echo "JSPACE_SMOKE_DECOY_LEGACY_SCHEMA_V1: helper only supports schemaVersion <= 1" >&2
exit 42
