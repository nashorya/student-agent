#!/usr/bin/env bash
set -euo pipefail

perl -0pi -e 's/return "experimental";/return "stable";/' src/features/target.ts
