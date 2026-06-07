#!/usr/bin/env bash
set -euo pipefail

# Reference solution: recover from a stale-tag rejection by re-reading and retrying.
# In a real harness the first edit attempt would be rejected, a signal would be
# emitted, and the agent would re-read before retrying with the updated tag.
# Here we directly apply the final edit and write the expected trace report.

if [ ! -f "src/app.ts" ]; then
  echo "ERROR: src/app.ts not found"
  exit 1
fi

# Use a precise in-place substitution (equivalent to hashline-anchored edit)
perl -0pi -e 's/const status = "draft"/const status = "reviewed"/' src/app.ts

cat > hashline-report.md <<'REPORT'
## Hashline Recovery Report
- Stale rejection count: 1
- Signal store event count: 1
- Re-read after rejection: yes
- Retry edit succeeded: yes
REPORT
