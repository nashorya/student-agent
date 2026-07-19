#!/usr/bin/env bash
set -euo pipefail
perl -0pi -e 's/api\.fetchUser/api.getUser/g' src/client.cjs
