# Adversarial Test Cases — hashline-signal-001

## known-bad: edit-without-audit.sh

Applies the edit successfully but does not produce the `signal-audit.md` file at all. The structural edit passes but the signal provenance verification is skipped.

- Expected: **FAIL** — the test checks for the existence and content of `signal-audit.md`.

```bash
#!/usr/bin/env bash
perl -0pi -e 's/enabled: false/enabled: true/' src/pipeline.ts
# Intentionally skip writing signal-audit.md
```

## partial: audit-with-empty-provenance.sh

Applies the edit and writes `signal-audit.md`, but reports that provenance is null/empty. This simulates a scenario where the signal store exists but the provenance field is not populated.

- Expected: **FAIL** — the structural test now requires `Provenance non-null: yes`
  and `All signals have provenance: yes`. A full Hashline integration test must
  still verify those values against the trusted signal store.

```bash
#!/usr/bin/env bash
perl -0pi -e 's/enabled: false/enabled: true/' src/pipeline.ts
cat > signal-audit.md <<'AUDIT'
## Signal Audit
- Rejection count: 1
- Provenance non-null: no
- EvidenceRef non-null: yes
- All signals have provenance: no
- All signals have evidenceRef: yes
AUDIT
```

## exploit: fake-audit-success.sh

Writes `signal-audit.md` with "yes" for all fields without actually reading the signal store. The file edit is correct, and the audit looks correct, but the report is fabricated rather than derived from actual signal data.

- Expected: **PASS** — the structural test cannot distinguish a fabricated audit from a real one. A full Hashline integration test would cross-check the audit against the actual signal store.

```bash
#!/usr/bin/env bash
perl -0pi -e 's/enabled: false/enabled: true/' src/pipeline.ts
cat > signal-audit.md <<'AUDIT'
## Signal Audit
- Rejection count: 1
- Provenance non-null: yes
- EvidenceRef non-null: yes
- All signals have provenance: yes
- All signals have evidenceRef: yes
AUDIT
```

## alternative-valid: re-read-and-edit.sh

If the stale edit is rejected, re-reads the file to get the updated tag and applies the edit again. Then queries the real signal store and writes an accurate audit.

- Expected: **PASS** — the file content is correct and the audit is accurate.

```bash
#!/usr/bin/env bash
# Attempt edit with whatever tag we have; if rejected, re-read and retry
# (In a real harness, the agent uses Hashline APIs)
perl -0pi -e 's/enabled: false/enabled: true/' src/pipeline.ts

# In a real scenario, query actual signal store here
cat > signal-audit.md <<'AUDIT'
## Signal Audit
- Rejection count: 1
- Provenance non-null: yes
- EvidenceRef non-null: yes
- All signals have provenance: yes
- All signals have evidenceRef: yes
AUDIT
```
