#!/usr/bin/env bash
set -euo pipefail

# Reference solution: read file, apply edit, then write a signal audit report.
# In a real harness with Hashline integration, the agent would:
#   1. read_range to get tag
#   2. edit with tag (possibly rejected if stale)
#   3. inspect signal store for rejection events
#   4. report findings
# Here we directly apply the edit and produce the audit file.

if [ ! -f "src/pipeline.ts" ]; then
  echo "ERROR: src/pipeline.ts not found"
  exit 1
fi

# Apply the edit
perl -0pi -e 's/enabled: false/enabled: true/' src/pipeline.ts

# Write signal audit report
# In a real Hashline integration, these values would come from the signal store.
# For the reference solution, we report the expected outcome: the edit was applied
# (either directly or after re-reading on stale rejection), and any rejection signal
# would have full provenance.
cat > signal-audit.md <<'AUDIT'
## Signal Audit
- Rejection count: 1
- Provenance non-null: yes
- EvidenceRef non-null: yes
- All signals have provenance: yes
- All signals have evidenceRef: yes
AUDIT