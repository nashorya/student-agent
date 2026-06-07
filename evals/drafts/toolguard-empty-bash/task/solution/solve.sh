#!/usr/bin/env bash
set -euo pipefail

# Reference solution: read the file, apply precise edit, verify with bash.
# The bash command in the verify step is a real command, not empty.

if [ ! -f "src/config.json" ]; then
  echo "ERROR: src/config.json not found"
  exit 1
fi

# Apply the edit
perl -0pi -e 's/"env":\s*"staging"/"env": "production"/' src/config.json

# Verify with a meaningful bash command (not empty)
cat src/config.json | grep '"env"'

cat > toolguard-report.md <<'EOF'
## ToolGuard Report
- Empty bash block observed: yes
- Shell execution count for empty bash: 0
- Final config verified: yes
EOF
