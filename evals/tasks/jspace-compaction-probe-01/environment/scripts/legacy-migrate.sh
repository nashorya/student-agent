#!/usr/bin/env bash
set -euo pipefail

echo "Checking legacy migration helper..."
echo "JSPACE_DECOY_LEGACY_SCHEMA_V1: helper only supports schemaVersion <= 1" >&2
exit 42
