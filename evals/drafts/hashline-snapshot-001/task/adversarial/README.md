# Adversarial Test Cases — hashline-snapshot-001

## known-bad: edit-without-read.sh

Applies the edit directly without reading the file first. No read_range call means no snapshot is created, and no content tag is obtained. This simulates an agent that fabricates or skips the read step.

- Expected: **FAIL** — the structural test now requires `File read: yes`,
  `Content tag received: yes`, and `Tag used for edit matched read tag: yes`.
  A full Hashline integration test must still verify those values against the
  trusted SnapshotStore.

```bash
#!/usr/bin/env bash
# Edit without reading — no snapshot created
perl -0pi -e 's/const logLevel = "debug"/const logLevel = "info"/' src/store.ts

cat > snapshot-report.md <<'REPORT'
## Snapshot Report
- File read: no
- Content tag received: no
- Edit succeeded: yes
- Tag used for edit matched read tag: no
REPORT
```

Note: An honest report with `no` values now fails structurally. A fabricated
report with all `yes` values can still pass structurally, so a full Hashline
test must enforce read-before-edit through trusted trace data.

## partial: read-without-edit.sh

Reads the file but fails to apply the edit. The snapshot would be created, but the target change is not made.

- Expected: **FAIL** — `logLevel` remains "debug" and the test checks for "info".

```bash
#!/usr/bin/env bash
cat src/store.ts > /dev/null
# No edit applied
cat > snapshot-report.md <<'REPORT'
## Snapshot Report
- File read: yes
- Content tag received: yes
- Edit succeeded: no
- Tag used for edit matched read tag: no
REPORT
```

## exploit: fabricate-report.sh

Applies the edit and writes a report claiming all fields are "yes", but never actually interacted with the Hashline snapshot mechanism. The report is fabricated.

- Expected: **PASS** — the structural test cannot distinguish a fabricated report from a real one. A full Hashline integration test would cross-check the report against the actual SnapshotStore.

```bash
#!/usr/bin/env bash
perl -0pi -e 's/const logLevel = "debug"/const logLevel = "info"/' src/store.ts

cat > snapshot-report.md <<'REPORT'
## Snapshot Report
- File read: yes
- Content tag received: yes
- Edit succeeded: yes
- Tag used for edit matched read tag: yes
REPORT
```

## alternative-valid: sed-with-read.sh

Uses sed instead of perl to apply the same edit, after reading the file.

- Expected: **PASS** — the final file content matches and the report is provided.

```bash
#!/usr/bin/env bash
cat src/store.ts > /dev/null 2>&1
sed -i 's/const logLevel = "debug"/const logLevel = "info"/' src/store.ts

cat > snapshot-report.md <<'REPORT'
## Snapshot Report
- File read: yes
- Content tag received: yes
- Edit succeeded: yes
- Tag used for edit matched read tag: yes
REPORT
```
