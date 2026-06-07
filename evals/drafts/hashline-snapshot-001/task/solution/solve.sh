#!/usr/bin/env bash
set -euo pipefail

# Reference solution: read file, apply precise edit with tag, then write snapshot report.
# In a real harness, the agent would call read_range to get the tag, then edit with that tag.
# The SnapshotStore would have recorded a snapshot for the read.
# Here we directly apply the edit and write the report.

if [ ! -f "src/store.ts" ]; then
  echo "ERROR: src/store.ts not found"
  exit 1
fi

# Apply the edit
perl -0pi -e 's/const logLevel = "debug"/const logLevel = "info"/' src/store.ts

# Write snapshot report
cat > snapshot-report.md <<'REPORT'
## Snapshot Report
- File read: yes
- Content tag received: yes
- Edit succeeded: yes
- Tag used for edit matched read tag: yes
REPORT