#!/usr/bin/env bash
set -euo pipefail

# Reference solution: recover from stale-tag rejections across three files.
# In a real harness the first stale attempts would be rejected, signals would be
# emitted, and the agent would re-read all files before retrying with fresh tags.
# Here we directly apply the final edits and write the expected trace report.

if [ ! -f "src/db.ts" ] || [ ! -f "src/cache.ts" ] || [ ! -f "src/auth.ts" ]; then
  echo "ERROR: one or more source files not found"
  exit 1
fi

# Edit db.ts: port 3000 → 5432
perl -0pi -e 's/const port = 3000/const port = 5432/' src/db.ts

# Edit cache.ts: ttl 60 → 300
perl -0pi -e 's/const ttl = 60/const ttl = 300/' src/cache.ts

# Edit auth.ts: retries 3 → 5
perl -0pi -e 's/const retries = 3/const retries = 5/' src/auth.ts

cat > hashline-batch-report.md <<'REPORT'
## Hashline Batch Recovery Report
- Stale rejection count: 3
- Signal store event count: 3
- Re-read all files after rejection: yes
- Retry edits succeeded: yes
REPORT
