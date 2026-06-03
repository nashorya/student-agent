#!/usr/bin/env bash
set -euo pipefail

perl -0pi -e 's/entry-120 status=pending/entry-120 status=ready/' src/catalog.txt
