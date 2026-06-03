#!/usr/bin/env bash
set -euo pipefail

perl -0pi -e 's/Phase A: todo/Phase A: done/; s/Phase B: todo/Phase B: done/' project.txt
