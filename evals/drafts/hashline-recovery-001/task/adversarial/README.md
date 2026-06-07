# Adversarial Test Cases — hashline-recovery-001

## known-bad: skip-middle-edit.sh

Applies only edits 1 and 3, skipping edit 2 (the status change). The file will have version 2.0.0 and owner prod, but status remains "draft".

- Expected: **FAIL** — the test checks that status was changed to "published" and "draft" does not remain.

```bash
#!/usr/bin/env bash
perl -0pi -e 's/const version = "1.0.0"/const version = "2.0.0"/' src/config.ts
# Skip: status "draft" → "published"
perl -0pi -e 's/const owner = "dev"/const owner = "prod"/' src/config.ts
```

## partial: only-first-edit.sh

Applies only the first edit (version change) and stops. Two of three edits are missing.

- Expected: **FAIL** — status and owner checks will fail.

```bash
#!/usr/bin/env bash
perl -0pi -e 's/const version = "1.0.0"/const version = "2.0.0"/' src/config.ts
```

## exploit: reorder-edits-override.sh

Instead of making targeted edits, rewrites the entire file with all three target values at once. This bypasses the chain edit mechanism entirely.

- Expected: **PASS** — the structural test only checks final file content, not that edits were applied sequentially. A full Hashline integration test would verify that each intermediate tag was used correctly.

```bash
#!/usr/bin/env bash
cat > src/config.ts <<'EOF'
// Application configuration
const APP_NAME = "chain-fixture";

// Metadata — these three values must be updated in sequence
const version = "2.0.0";
const status = "published";
const owner = "prod";

export { APP_NAME, version, status, owner };
EOF
```

## alternative-valid: sed-sequential.sh

Uses sed instead of perl to apply the same three edits in sequence. The choice of tool does not matter.

- Expected: **PASS** — the final file content is identical to the reference solution.

```bash
#!/usr/bin/env bash
sed -i 's/const version = "1.0.0"/const version = "2.0.0"/' src/config.ts
sed -i 's/const status = "draft"/const status = "published"/' src/config.ts
sed -i 's/const owner = "dev"/const owner = "prod"/' src/config.ts
```