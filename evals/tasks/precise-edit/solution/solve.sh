#!/usr/bin/env bash
set -euo pipefail

perl -0pi -e 's/status: draft/status: reviewed/' src/message.txt
