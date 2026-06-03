#!/usr/bin/env bash
set -euo pipefail

perl -0pi -e 's/return a - b;/return a + b;/' src/calculator.js
