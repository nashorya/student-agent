#!/usr/bin/env bash
set -euo pipefail

perl -0pi -e 's/color=red/color=blue/g' src/alpha.txt src/beta.txt
