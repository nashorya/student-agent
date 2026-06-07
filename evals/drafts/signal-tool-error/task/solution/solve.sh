#!/usr/bin/env bash
set -euo pipefail

# Reference solution: fix the optional chaining bug and add sumValues function.
# This is one valid approach — the eval does not lock in a specific implementation.

if [ ! -f "src/process.ts" ]; then
  echo "ERROR: src/process.ts not found"
  exit 1
fi

cat > src/process.ts <<'EOF'
interface DataItem {
  id: string;
  value?: number;
  label: string;
}

const items: DataItem[] = [
  { id: "a1", value: 10, label: "first" },
  { id: "b2", value: undefined, label: "empty" },
  { id: "c3", value: 30, label: "third" },
];

function extractValues(data: DataItem[]): number[] {
  return data.map(r => r.value ?? 0);
}

function sumValues(data: DataItem[]): number {
  return data.reduce((sum, r) => sum + (r.value ?? 0), 0);
}

export { extractValues, sumValues, items };
export type { DataItem };
EOF

cat > tool-error-signal-report.md <<'EOF'
## Tool Error Signal Report
- Tool error count: 1
- Provenance non-null: yes
- Main task continued after error: yes
EOF
