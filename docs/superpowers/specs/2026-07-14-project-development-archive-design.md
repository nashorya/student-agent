# Project Development Archive + Human Dashboard Design

- Date: 2026-07-14
- Status: draft for final user review
- Scope: short-term v0.4x product goal

## 1. Goal

Student-agent should maintain a durable project development archive in every target repository it works on. The archive records stable project knowledge through an INDEX timeline, ADRs, bug records, and verification evidence.

Markdown in the target repository is the canonical source of truth. A self-contained static HTML dashboard is generated from that Markdown so users can understand project health, history, decisions, bugs, and evidence without reading several files manually.

The HTML dashboard is a derived human view. It is not an editor, database, or second source of truth.

## 2. Selected Approach

Use an Archive Engine with format adapters and a static HTML renderer.

```text
Student-agent task workflow
        |
        v
Archive Engine
  |- Discover project archive conventions
  |- Read and normalize existing Markdown
  |- Stage archive actions during task execution
  |- Apply validated, idempotent updates
  |- Validate identifiers, states, links, and evidence
  `- Render a self-contained dashboard.html
```

This approach was selected over:

- Generalizing the existing `scripts/build-dashboard.ts` only. That would improve presentation but would not provide reliable archive maintenance or cross-project behavior.
- Making SQLite or JSON the canonical store. That would create a second source of truth and weaken Git review, manual editing, and project portability.

## 3. Canonical Archive Structure

When a project has no compatible archive convention, Student-agent proposes initializing:

```text
docs/agent/
  INDEX.md
  buglog.md
  adr/
    ADR-001-*.md
  dashboard.html
  archive.json
```

`archive.json` contains configuration and generation metadata only. It must not duplicate the archive body content.

Projects with existing `docs/adr/`, `docs/decisions/`, bug logs, or project timelines keep their existing locations and conventions.

## 4. Discovery and Format Adoption

Archive discovery uses this precedence:

1. Explicit project configuration in `.student-agent.json`.
2. Existing recognized project conventions.
3. The default `docs/agent/` structure.

Recognized candidates include:

- `docs/adr/`
- `docs/decisions/`
- `docs/architecture/decisions/`
- `docs/buglog.md`
- INDEX, changelog, roadmap, or history documents with a stable timeline structure

If multiple plausible locations exist, Student-agent must not choose silently. It asks once, then records the selected paths in project configuration.

If no archive exists, Student-agent requests one-time authorization before initialization. After authorization, subsequent qualifying tasks maintain the archive automatically.

## 5. Archive Components

### 5.1 ArchiveDiscover

Finds configuration, known paths, candidate formats, conflicts, and write capability.

### 5.2 ArchiveAdapter

Converts project Markdown into a normalized in-memory model and applies targeted updates without discarding unknown content.

Initial adapters:

- `CanonicalArchiveAdapter`: full read/write support for the Student-agent default format.
- `ConventionalMarkdownAdapter`: safe adoption of common ADR and buglog structures, including YAML frontmatter.
- `ReadOnlyArchiveAdapter`: reads unknown formats for context and HTML but refuses unsafe round-trip writes.

Adapter rules:

- Preserve existing numbering, frontmatter, headings, custom fields, and manual notes.
- Modify only the relevant field or append a new history entry.
- Never migrate or rewrite an entire archive merely to normalize formatting.

### 5.3 ArchiveService

Owns normalized entities, staged actions, idempotency, validation, and transactional application.

Normalized entities:

- `ArchiveProject`
- `ArchiveTimelineEntry`
- `ArchiveAdr`
- `ArchiveBug`
- `ArchiveEvidence`

### 5.4 ArchiveValidate

Validates source text and proposed output before any canonical file is replaced.

### 5.5 ArchiveRenderHtml

Renders the normalized read-only model to a deterministic, self-contained static HTML file.

## 6. Workflow Integration

```text
Project entry
-> discover archive policy and paths
-> load relevant decisions, bugs, and recent timeline entries

Task execution
-> detect stable project knowledge
-> stage pending archive actions
-> do not repeatedly rewrite files during intermediate reasoning

Technical verification
-> attach build, test, eval, diff, or commit evidence
-> apply eligible Markdown updates transactionally
-> validate the resulting archive
-> regenerate dashboard.html

Task completion
-> report archive entities created or updated
-> request user acceptance for verified proposed ADRs
```

Qualifying events:

| Event | Archive action |
|---|---|
| A long-lived architectural choice is identified | Create or update a proposed ADR |
| A reproducible defect is found | Create an OPEN bug |
| Root cause becomes evidence-backed | Append root-cause evidence |
| A fix passes targeted verification | Mark the bug FIXED and attach evidence |
| A stable milestone or important capability completes | Append an INDEX timeline entry |
| A change is minor or has no durable project value | Do not update the archive |

Every staged action carries an idempotency key:

```text
taskId + actionType + entityId + targetStatus
```

Session recovery or completion retries must not duplicate ADRs, bugs, history records, or timeline entries.

## 7. ADR Lifecycle and User Acceptance

ADR decision state and implementation state are independent:

```yaml
decision_status: proposed | accepted | rejected | superseded
implementation_status: planned | in_progress | verified | not_applicable
```

Lifecycle:

```text
Architectural decision discovered
-> proposed + planned

Implementation begins
-> proposed + in_progress

Implementation and verification complete
-> proposed + verified
-> Agent presents decision, implementation, and verification evidence
-> Agent explicitly asks the user for acceptance

User accepts
-> accepted + verified
-> append acceptance history and INDEX event
-> regenerate HTML
```

If the user does not accept, the ADR remains `proposed + verified` and records the feedback. Student-agent must not claim it is accepted.

## 8. Bug Lifecycle

Primary lifecycle:

```text
OPEN -> INVESTIGATING -> FIXED -> CLOSED
```

Additional states:

- `WONTFIX`
- `DUPLICATE`
- `CANNOT_REPRODUCE`
- `REOPENED`

State transitions append history instead of erasing prior conclusions:

```yaml
history:
  - at: 2026-07-14T08:00:00Z
    from: OPEN
    to: INVESTIGATING
    evidence: run:example
```

`FIXED` requires technical verification evidence. `CLOSED` requires a stable task conclusion. Unsupported success claims must not change bug state.

## 9. INDEX Responsibilities

INDEX is the high-level project timeline and navigation surface. It does not duplicate ADR or bug bodies.

Each timeline entry may link:

```text
date -> event summary -> ADR/BUG -> commit -> verification evidence
```

INDEX updates are append-oriented and idempotent.

## 10. HTML Information Architecture

The selected layout is **A: Project Health Overview**.

Pages:

- Overview
- Timeline
- Bugs
- ADRs
- Verification
- Search

Overview answers:

- What is the current project state?
- Which risks or OPEN bugs need attention?
- Which verified ADRs are waiting for user acceptance?
- What changed recently?
- What is the next stable action?

The page includes project health, OPEN bug count, proposed/accepted ADR counts, archive validation state, recent progress, and items requiring attention.

Timeline, Bugs, ADRs, and Verification are drill-down views. Users can open an entry to read the complete rendered Markdown, history, cross-links, and evidence.

The HTML must provide:

- Full-text search
- Status and type filters
- Keyboard navigation and visible focus states
- Responsive layouts without horizontal page scrolling
- Semantic headings and table alternatives for narrow screens
- Accessible status labels that do not rely on color alone
- A visible generation timestamp and source hash state

## 11. Rendering Boundaries

- Output is a static, self-contained HTML file.
- No server, database, authentication, or runtime installation is required.
- Markdown remains editable by humans and reviewable in Git.
- HTML is not editable and is always safe to regenerate.
- Project content must be HTML-escaped or passed through a sanitized Markdown renderer.
- Generated HTML records source hashes so users can see whether it is current or stale.

## 12. Validation and Failure Handling

Archive updates follow a transaction-like pipeline:

```text
read sources
-> validate UTF-8 and structure
-> build proposed normalized result in memory
-> reparse proposed output
-> atomically replace canonical Markdown
-> render HTML
```

Blocking validation failures:

- Binary or invalid UTF-8 canonical Markdown
- NUL bytes
- Duplicate ADR or bug identifiers
- Illegal states or transitions
- Broken required internal links
- Attempted overwrite of unknown or unparseable content
- Accepted ADR without a recorded user acceptance event
- FIXED bug without verification evidence

Failure behavior:

- Unknown formats become read-only rather than being overwritten.
- Canonical Markdown parse or validation failure blocks archive writes.
- HTML generation failure produces a warning but does not undo a valid code task or valid Markdown archive update.
- Failure to persist ADR acceptance means Student-agent must report that acceptance was not recorded.
- Atomic writes preserve the original file on failure.

## 13. Testing Strategy

### Adapter tests

- Default canonical format
- Existing `docs/adr/` layouts
- YAML frontmatter preservation
- Custom headings and unknown field preservation
- Read-only fallback for unsafe formats

### Safety tests

- Binary Markdown and NUL bytes
- Invalid UTF-8
- Duplicate identifiers
- Broken links
- Illegal lifecycle transitions
- HTML/script injection in titles, logs, or evidence
- Interrupted writes preserve original files

### Workflow tests

- Stable event creates one pending archive action
- Completion retry does not duplicate entries
- `proposed -> verified -> request acceptance -> accepted`
- User rejection preserves `proposed + verified` with feedback
- FIXED bug requires verifier evidence
- Small changes do not create archive noise

### HTML tests

- Overview health summaries
- Timeline, bug, ADR, and verification navigation
- Search and filtering
- Keyboard navigation and accessible labels
- Responsive behavior
- Deterministic output for identical normalized input
- Source hashes correctly report current and stale output

## 14. Commands and User Surface

MVP commands:

```text
/archive status
/archive init
/archive check
/archive build
/archive adr new <title>
/archive bug open <title>
/archive bug update <id>
```

Normal task completion should call the same ArchiveService operations internally. Slash commands are explicit control and diagnostics surfaces, not a separate implementation path.

## 15. MVP Scope

Included:

- Cross-project discovery
- Default archive initialization with one-time user authorization
- Canonical and conventional Markdown adapters
- INDEX, ADR, bug, and verification maintenance
- ADR user acceptance workflow
- Validation and idempotent writes
- Static health-overview dashboard
- Search, filters, detailed entry views, accessibility, and responsive layout
- Slash commands for status, initialization, checking, building, and explicit creation/update

Excluded:

- Editing archive content from HTML
- Database-backed canonical storage
- Authentication or hosted collaboration
- Automatic acceptance of ADRs
- Automatic migration of existing archives
- Complex project-management boards
- Advanced analytics or chart-heavy reporting
- Automatic archive updates for every trivial task

## 16. Delivery Slices

The capability is delivered in three independently verifiable slices so the short-term goal produces a visible result early.

### Slice 1: Safe read model and health dashboard

- Restore the currently corrupted ADR working-tree files from known-good Git content.
- Add text-integrity validation for canonical Markdown.
- Implement archive discovery and normalized read models.
- Render the selected Project Health Overview from the default format and recognized existing paths.
- Provide `/archive status`, `/archive check`, and `/archive build`.

### Slice 2: Validated archive mutations

- Add canonical Markdown initialization.
- Add targeted ADR, bug, and INDEX mutations.
- Add atomic writes, lifecycle validation, evidence rules, and idempotency.
- Provide `/archive init`, `/archive adr new`, `/archive bug open`, and `/archive bug update`.

### Slice 3: Task workflow integration

- Stage archive actions during normal task execution.
- Apply eligible actions after technical verification.
- Request user acceptance for `proposed + verified` ADRs.
- Persist accepted decisions and regenerate HTML after user confirmation.
- Add conventional-format write adapters where round-trip safety is proven.

## 17. Acceptance Criteria

1. Student-agent discovers and adopts an existing ADR directory without moving or rewriting unrelated content.
2. A project without archives can initialize the default structure after one user authorization.
3. A reproducible bug can progress through root-cause and verified-fix evidence without duplicate history on retry.
4. A proposed ADR remains proposed after implementation until the user explicitly accepts it.
5. User acceptance produces an accepted ADR, acceptance history, INDEX entry, and refreshed HTML.
6. Binary, invalid, duplicate, or unparseable archive sources are rejected before canonical replacement.
7. The dashboard provides an accessible project health overview, search, filters, and full entry reading.
8. The same normalized archive input produces deterministic HTML.
9. Source hashes indicate when the HTML is stale.
10. Archive maintenance failure cannot silently convert an unsuccessful archive operation into a success claim.
11. Ordinary low-value edits create no archive noise.
12. The feature works in non-Node target repositories without requiring their package manager or frontend toolchain.

## 18. Existing Prototype Relationship

The current `scripts/build-dashboard.ts` and `docs/dashboard.html` remain reference material only. Their parsing and rendering logic should not become the cross-project architecture boundary.

The implementation may reuse small presentation ideas, but parsing, validation, workflow integration, and rendering must be separated into independently testable components.
