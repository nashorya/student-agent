#!/usr/bin/env bash
set -euo pipefail

perl -0pi -e 's/\(daysInMonth \+ 1\)/daysInMonth/' src/billing/proration.js
