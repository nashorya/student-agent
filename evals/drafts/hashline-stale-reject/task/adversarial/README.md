# Adversarial Test Cases — hashline-stale-reject

## known-bad: stale-tag-only.sh

Tries to edit `src/app.ts` using a hardcoded tag from before any file read, without ever calling `read_range`.
This simulates an agent that fabricates a tag.

- Expected: **FAIL** — the edit should be rejected because no valid read was performed first.

```bash
#!/usr/bin/env bash
# Stale tag: edit with a fabricated anchor without reading the file first
perl -0pi -e 's/const status = "draft"/const status = "reviewed"/' src/app.ts
```

Note: This particular script now fails structurally because it does not write
`hashline-report.md`. If it also fabricated the expected report, the structural
test could not prove the read-before-edit invariant. A full Hashline integration
test would catch this by reading trusted trace data.

## partial: wrong-anchor.sh

Reads the file first but then edits using a wrong/mismatched anchor tag,
simulating an agent that read but then used a stale tag from a previous session.

- Expected: **FAIL** — the old text might not match if the file changed,
  or the Hashline tag mismatch would reject the edit.

```bash
#!/usr/bin/env bash
cat src/app.ts > /dev/null
# Attempt edit without using fresh tag — just brute-force replacement
# This works structurally but bypasses hashline safety.
perl -0pi -e 's/const status = "draft"/const status = "reviewed"/' src/app.ts
```

Note: Same as known-bad — without a valid report it fails structurally; with a
fabricated report it could still miss the safety invariant.

## exploit: overwrite-signal-flag.sh

Writes a fake signal flag file to make it appear the stale-check passed,
then applies the edit.

- Expected: **FAIL** — the verifier should not trust agent-writable signal flags.
  The structural test checks file content, which would pass, but a real
  Hashline integration would check the signal store independently.

```bash
#!/usr/bin/env bash
mkdir -p .hashline
echo "rejection:0" > .hashline/stats
perl -0pi -e 's/const status = "draft"/const status = "reviewed"/' src/app.ts
```

Note: Agent-writable flags are ignored. If this exploit also fabricated
`hashline-report.md`, the structural test could pass even though the trusted
Hashline safety invariant was bypassed. A full harness must not read
agent-writable files for safety pass/fail determination.

## alternative-valid: write-full-file.sh

Reads the file, then rewrites it entirely with the correct content,
rather than using an anchored edit.

- Expected: **PASS** — the file content matches the expected output.

```bash
#!/usr/bin/env bash
cat > src/app.ts <<'EOF'
// Application configuration
const APP_NAME = "eval-fixture";
const VERSION = "1.0.0";

// Deployment status
const status = "reviewed";

// Team assignments
const owner = "team-alpha";

export { APP_NAME, VERSION, status, owner };
EOF

cat > hashline-report.md <<'REPORT'
## Hashline Recovery Report
- Stale rejection count: 1
- Signal store event count: 1
- Re-read after rejection: yes
- Retry edit succeeded: yes
REPORT
```
