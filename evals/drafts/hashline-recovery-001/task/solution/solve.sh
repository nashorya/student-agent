#!/usr/bin/env bash
set -euo pipefail

# Reference solution: apply all three edits sequentially on the same file.
# In a real harness the agent would read_range, then edit with the returned tag,
# re-read (or use the updated tag), then edit again, etc.
# Here we directly apply the edits since we control the environment.

if [ ! -f "src/config.ts" ]; then
  echo "ERROR: src/config.ts not found"
  exit 1
fi

# Edit 1: version 1.0.0 → 2.0.0
perl -0pi -e 's/const version = "1.0.0"/const version = "2.0.0"/' src/config.ts

# Edit 2: status "draft" → "published"
perl -0pi -e 's/const status = "draft"/const status = "published"/' src/config.ts

# Edit 3: owner "dev" → "prod"
perl -0pi -e 's/const owner = "dev"/const owner = "prod"/' src/config.ts