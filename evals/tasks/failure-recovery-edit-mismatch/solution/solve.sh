#!/usr/bin/env bash
set -euo pipefail

perl -0pi -e 's/\[beta\]\nstatus: pending/\[beta\]\nstatus: approved/' src/releases.txt
