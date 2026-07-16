# Project Development Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-project Archive Engine that safely maintains INDEX, ADR, bug, and verification Markdown and renders an accessible static Project Health Dashboard.

**Architecture:** A new `src/archive/` subsystem owns discovery, normalized archive types, adapters, validation, mutations, pending actions, and rendering. Pi receives an `archive_record` tool that stages durable actions during work; slash commands and task-completion/user-review paths call the same `ArchiveService`. Markdown remains canonical and HTML remains deterministic derived output.

**Tech Stack:** TypeScript ESM, Node.js filesystem APIs, Pi `defineTool`/TypeBox, Vitest, existing `marked` package only where output is explicitly sanitized.

---

## File Structure

Create:

- `src/archive/types.ts` — normalized entities, configuration, action, validation, and result types.
- `src/archive/text-integrity.ts` — strict UTF-8/NUL/binary checks and source hashes.
- `src/archive/discovery.ts` — explicit config and conventional path discovery.
- `src/archive/adapters/markdown-adapter.ts` — adapter contract.
- `src/archive/adapters/canonical-markdown.ts` — canonical/default Markdown read and write support.
- `src/archive/adapters/conventional-markdown.ts` — safe common-format reader and round-trip capability detection.
- `src/archive/validate.ts` — cross-entity IDs, lifecycle, link, evidence, and acceptance validation.
- `src/archive/pending-actions.ts` — persistent idempotent staged-action ledger.
- `src/archive/html-renderer.ts` — deterministic Project Health Overview renderer.
- `src/archive/service.ts` — transaction-like orchestration and atomic writes.
- `src/archive/commands.ts` — `/archive` command execution and formatting.
- `src/archive/workflow.ts` — task completion and ADR user-acceptance integration.
- `src/archive/index.ts` — public exports.
- `src/core/pi-bridge/archive-tool.ts` — Pi tool for staging archive actions.
- Co-located `__tests__` and `fixtures` under `src/archive/`.

Modify:

- `src/core/config/types.ts` — archive feature/config types and defaults.
- `src/core/config/loader.ts` — merge archive configuration.
- `src/core/config/__tests__/loader.test.ts` — configuration coverage.
- `src/core/pi-bridge/session-factory.ts` — register `archive_record`.
- `src/core/pi-bridge/__tests__/session-factory.test.ts` — custom tool inventory.
- `src/cli/command-parser.ts` — `/archive` grammar, help, and completions.
- `src/cli/__tests__/command-parser.test.ts` — parser coverage.
- `src/extension/index.ts` — interactive/readline command dispatch and acceptance hook.
- `src/memory/tasks/types.ts` — pending ADR acceptance reference on active task.
- `src/memory/tasks/manager.ts` — store/clear acceptance reference.
- `src/memory/tasks/__tests__/manager.test.ts` — persistence coverage.
- `.gitignore` — keep `.superpowers/` ignored while allowing committed specs/plans.
- `README.md` and `README.zh.md` — archive behavior and commands.

Delete after migration:

- Keep `scripts/build-dashboard.ts` as a compatibility wrapper that calls `ArchiveService.build()`; do not delete it in this change.

---

### Task 0: Recover Canonical ADR Text and Add a Regression Fixture

**Files:**
- Restore: `docs/adr/ADR-003-v04x-priority-reorder.md`
- Restore: `docs/adr/ADR-004-knack-schema-v1.md`
- Restore: `docs/adr/ADR-005-recall-ranking-protocol.md`
- Restore: `docs/adr/ADR-006-recall-citation-and-credit.md`
- Create: `src/archive/__tests__/fixtures/binary-markdown.bin`

- [ ] **Step 1: Prove the working-tree corruption before restoration**

Run:

```bash
file docs/adr/ADR-00{3,4,5,6}-*.md
git diff --numstat -- docs/adr
```

Expected: each affected file is reported as `data`, and numstat reports `- -`.

- [ ] **Step 2: Restore only the four known-corrupt paths from HEAD**

Run:

```bash
git restore --source=HEAD -- \
  docs/adr/ADR-003-v04x-priority-reorder.md \
  docs/adr/ADR-004-knack-schema-v1.md \
  docs/adr/ADR-005-recall-ranking-protocol.md \
  docs/adr/ADR-006-recall-citation-and-credit.md
```

Expected: the four files return to UTF-8 Markdown; unrelated changes remain untouched.

- [ ] **Step 3: Create a binary regression fixture**

Use the first 256 bytes of one preserved corrupt blob if available under `/tmp`; otherwise create a deterministic fixture containing invalid UTF-8 and NUL bytes. The checked-in fixture must be used only by archive integrity tests.

- [ ] **Step 4: Verify recovery**

Run:

```bash
file docs/adr/ADR-00{3,4,5,6}-*.md
git diff --numstat -- docs/adr
```

Expected: UTF-8 text and no ADR diff.

- [ ] **Step 5: Commit**

```bash
git add src/archive/__tests__/fixtures/binary-markdown.bin
git commit -m "test: add corrupt markdown archive fixture"
```

---

### Task 1: Define Archive Types, Configuration, and Text Integrity

**Files:**
- Create: `src/archive/types.ts`
- Create: `src/archive/text-integrity.ts`
- Create: `src/archive/__tests__/text-integrity.test.ts`
- Modify: `src/core/config/types.ts`
- Modify: `src/core/config/loader.ts`
- Modify: `src/core/config/__tests__/loader.test.ts`

- [ ] **Step 1: Write failing text-integrity and config tests**

```ts
it('rejects NUL and invalid UTF-8 before parsing Markdown', async () => {
  await expect(readArchiveText(binaryFixture)).rejects.toThrow('Archive source is not valid UTF-8');
});

it('loads project archive configuration', async () => {
  await writeFile(join(tmpDir, '.student-agent.json'), JSON.stringify({
    features: { projectArchive: true },
    archive: { indexPath: 'docs/history.md', adrDir: 'docs/decisions' },
  }));
  const config = await loadStudentAgentConfig({ cwd: tmpDir });
  expect(config.features.projectArchive).toBe(true);
  expect(config.archive.adrDir).toBe('docs/decisions');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx vitest run src/archive/__tests__/text-integrity.test.ts src/core/config/__tests__/loader.test.ts
```

Expected: FAIL because archive types/config and `readArchiveText` do not exist.

- [ ] **Step 3: Implement normalized types**

```ts
export type AdrDecisionStatus = 'proposed' | 'accepted' | 'rejected' | 'superseded';
export type AdrImplementationStatus = 'planned' | 'in_progress' | 'verified' | 'not_applicable';
export type BugStatus = 'OPEN' | 'INVESTIGATING' | 'FIXED' | 'CLOSED' | 'WONTFIX' | 'DUPLICATE' | 'CANNOT_REPRODUCE' | 'REOPENED';

export interface ArchiveConfig {
  enabled: boolean;
  format: 'auto' | 'canonical' | 'conventional';
  indexPath?: string;
  buglogPath?: string;
  adrDir?: string;
  dashboardPath?: string;
}

export interface ArchiveAdr {
  id: string;
  title: string;
  decisionStatus: AdrDecisionStatus;
  implementationStatus: AdrImplementationStatus;
  date: string;
  body: string;
  sourcePath: string;
  acceptance?: { acceptedAt: string; acceptedBy: 'user'; evidenceRef: string };
  history: ArchiveHistoryEntry[];
}

export interface ArchiveBug {
  id: string;
  title: string;
  status: BugStatus;
  symptom: string;
  rootCause?: string;
  fix?: string;
  evidence: ArchiveEvidence[];
  history: ArchiveHistoryEntry[];
  sourcePath: string;
}

export interface ArchiveProject {
  root: string;
  indexPath: string;
  buglogPath: string;
  adrDir: string;
  dashboardPath: string;
  timeline: ArchiveTimelineEntry[];
  adrs: ArchiveAdr[];
  bugs: ArchiveBug[];
  evidence: ArchiveEvidence[];
  sourceHashes: Record<string, string>;
}
```

- [ ] **Step 4: Implement strict reads and hashing**

```ts
const decoder = new TextDecoder('utf-8', { fatal: true });

export async function readArchiveText(path: string): Promise<{ text: string; sha256: string }> {
  const bytes = await readFile(path);
  if (bytes.includes(0)) throw new Error(`Archive source contains NUL bytes: ${path}`);
  let text: string;
  try { text = decoder.decode(bytes); }
  catch { throw new Error(`Archive source is not valid UTF-8: ${path}`); }
  return { text, sha256: createHash('sha256').update(bytes).digest('hex') };
}
```

- [ ] **Step 5: Add config defaults and merge support**

Add `features.projectArchive: true` and:

```ts
archive: {
  enabled: true,
  format: 'auto',
  dashboardPath: 'docs/agent/dashboard.html',
}
```

Extend `StudentAgentConfigInput`, `mergeConfig`, and environment parsing with `STUDENT_AGENT_FEATURE_PROJECT_ARCHIVE`.

- [ ] **Step 6: Run tests and commit**

```bash
npx vitest run src/archive/__tests__/text-integrity.test.ts src/core/config/__tests__/loader.test.ts
git add src/archive src/core/config
git commit -m "feat(archive): add archive types and text integrity"
```

---

### Task 2: Implement Cross-Project Discovery and Read Adapters

**Files:**
- Create: `src/archive/discovery.ts`
- Create: `src/archive/adapters/markdown-adapter.ts`
- Create: `src/archive/adapters/canonical-markdown.ts`
- Create: `src/archive/adapters/conventional-markdown.ts`
- Create: `src/archive/__tests__/discovery.test.ts`
- Create: `src/archive/__tests__/canonical-markdown.test.ts`
- Create: `src/archive/__tests__/conventional-markdown.test.ts`
- Create fixtures under `src/archive/__tests__/fixtures/projects/`

- [ ] **Step 1: Write failing discovery tests**

```ts
it('prefers explicit project archive paths', async () => {
  const result = await discoverArchive(tmpDir, {
    enabled: true,
    format: 'auto',
    indexPath: 'project/HISTORY.md',
    adrDir: 'project/decisions',
  });
  expect(result.paths.indexPath).toBe('project/HISTORY.md');
  expect(result.paths.adrDir).toBe('project/decisions');
});

it('reports conflicting ADR directories instead of choosing silently', async () => {
  await mkdir(join(tmpDir, 'docs/adr'), { recursive: true });
  await mkdir(join(tmpDir, 'docs/decisions'), { recursive: true });
  const result = await discoverArchive(tmpDir, defaultArchiveConfig());
  expect(result.writeMode).toBe('blocked');
  expect(result.conflicts).toContain('multiple_adr_directories');
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/archive/__tests__/discovery.test.ts src/archive/__tests__/*markdown.test.ts
```

Expected: FAIL because discovery/adapters are absent.

- [ ] **Step 3: Implement the adapter contract**

```ts
export interface ArchiveAdapter {
  readonly kind: 'canonical' | 'conventional' | 'read_only';
  readonly canWrite: boolean;
  read(root: string, paths: ArchivePaths): Promise<ArchiveProject>;
  serializeAdr?(adr: ArchiveAdr, previous?: string): string;
  serializeBuglog?(bugs: ArchiveBug[], previous?: string): string;
  serializeIndex?(timeline: ArchiveTimelineEntry[], previous?: string): string;
}
```

- [ ] **Step 4: Implement discovery precedence**

```ts
const ADR_DIR_CANDIDATES = ['docs/adr', 'docs/decisions', 'docs/architecture/decisions'];
const BUGLOG_CANDIDATES = ['docs/buglog.md', 'docs/bugs.md', 'BUGS.md'];
const INDEX_CANDIDATES = ['docs/INDEX.md', 'docs/agent/INDEX.md', 'CHANGELOG.md'];
```

Return explicit `writeMode: 'read_write' | 'read_only' | 'blocked'`, conflicts, and whether initialization authorization is required.

- [ ] **Step 5: Implement safe readers**

Support both YAML frontmatter and bold metadata such as `- **状态**：已采纳`. Normalize known fields but preserve the full original body and source path. A conventional file becomes writable only when every required field has an unambiguous source span.

- [ ] **Step 6: Run tests and commit**

```bash
npx vitest run src/archive/__tests__/discovery.test.ts src/archive/__tests__/canonical-markdown.test.ts src/archive/__tests__/conventional-markdown.test.ts
git add src/archive
git commit -m "feat(archive): discover and read project archives"
```

---

### Task 3: Validate Normalized Archives and Lifecycle Rules

**Files:**
- Create: `src/archive/validate.ts`
- Create: `src/archive/__tests__/validate.test.ts`

- [ ] **Step 1: Write failing validation tests**

```ts
it('rejects accepted ADRs without user acceptance evidence', () => {
  const project = fixtureProject({ adrs: [fixtureAdr({ decisionStatus: 'accepted', acceptance: undefined })] });
  expect(validateArchive(project).errors).toContainEqual(expect.objectContaining({ code: 'accepted_adr_without_user_evidence' }));
});

it('rejects FIXED bugs without verification evidence', () => {
  const project = fixtureProject({ bugs: [fixtureBug({ status: 'FIXED', evidence: [] })] });
  expect(validateArchive(project).errors).toContainEqual(expect.objectContaining({ code: 'fixed_bug_without_verification' }));
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/archive/__tests__/validate.test.ts
```

- [ ] **Step 3: Implement validation**

```ts
export function validateArchive(project: ArchiveProject): ArchiveValidationResult {
  const errors: ArchiveValidationIssue[] = [];
  validateUniqueIds(project.adrs, 'ADR', errors);
  validateUniqueIds(project.bugs, 'BUG', errors);
  for (const adr of project.adrs) {
    if (adr.decisionStatus === 'accepted' && adr.acceptance?.acceptedBy !== 'user') {
      errors.push(issue('accepted_adr_without_user_evidence', adr.sourcePath));
    }
  }
  for (const bug of project.bugs) {
    if (bug.status === 'FIXED' && !bug.evidence.some((item) => item.kind === 'verification' && item.status === 'passed')) {
      errors.push(issue('fixed_bug_without_verification', bug.sourcePath));
    }
  }
  validateInternalLinks(project, errors);
  return { ok: errors.length === 0, errors, warnings: [] };
}
```

- [ ] **Step 4: Add transition tests**

Cover ADR decision/implementation axes and bug transitions. Explicitly reject `OPEN -> CLOSED`, `accepted -> proposed`, and `proposed -> accepted` without a user evidence reference.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run src/archive/__tests__/validate.test.ts
git add src/archive/validate.ts src/archive/__tests__/validate.test.ts
git commit -m "feat(archive): validate archive lifecycle and evidence"
```

---

### Task 4: Render the Static Project Health Dashboard

**Files:**
- Create: `src/archive/html-renderer.ts`
- Create: `src/archive/__tests__/html-renderer.test.ts`
- Create: `src/archive/__tests__/fixtures/dashboard-project.ts`
- Modify: `scripts/build-dashboard.ts`

- [ ] **Step 1: Write failing renderer tests**

```ts
it('renders project health, attention items, search, filters, and full entry data', () => {
  const html = renderArchiveHtml(dashboardProject());
  expect(html).toContain('Project Health');
  expect(html).toContain('ADR waiting for acceptance');
  expect(html).toContain('data-search-text=');
  expect(html).toContain('aria-label="Filter archive entries"');
  expect(html).toContain('source-hash-state');
});

it('escapes project-controlled HTML', () => {
  const html = renderArchiveHtml(dashboardProject({ title: '<script>alert(1)</script>' }));
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/archive/__tests__/html-renderer.test.ts
```

- [ ] **Step 3: Implement deterministic renderer helpers**

```ts
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderArchiveHtml(project: ArchiveProject): string {
  const model = buildDashboardModel(project);
  const styles = `
    :root{color-scheme:light dark;--bg:#0b0d10;--surface:#151922;--text:#f4f6f8;--muted:#9aa4b2;--accent:#7dd3fc}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,sans-serif}
    a,button,input,select{font:inherit}a{color:var(--accent)}:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
    .shell{max-width:1440px;margin:auto;padding:24px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
    .card,.panel{background:var(--surface);border:1px solid #303846;border-radius:12px;padding:16px}.muted{color:var(--muted)}
    @media(max-width:720px){.shell{padding:12px}.desktop-table{display:none}.mobile-list{display:block}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
  `;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body>
    ${renderOverview(model)}
    ${renderNavigation(model)}
    ${renderTimeline(model)}
    ${renderBugs(model)}
    ${renderAdrs(model)}
    ${renderVerification(model)}
    <script>${SEARCH_AND_FILTER_SCRIPT}</script>
  </body></html>`;
}
```

The inline script may only filter already-rendered escaped text and switch views. It must not evaluate archive content or use `innerHTML` with user data.

- [ ] **Step 4: Add accessibility and responsive assertions**

Assert semantic landmarks, sequential headings, visible focus CSS, `prefers-reduced-motion`, text labels alongside color badges, and a mobile layout without fixed page widths.

- [ ] **Step 5: Turn the old script into a wrapper**

```ts
import { ArchiveService } from '../src/archive/service.js';

const result = await new ArchiveService({ root: process.cwd() }).build();
console.log(JSON.stringify(result, null, 2));
```

- [ ] **Step 6: Run tests and commit**

```bash
npx vitest run src/archive/__tests__/html-renderer.test.ts
git add src/archive scripts/build-dashboard.ts
git commit -m "feat(archive): render project health dashboard"
```

---

### Task 5: Implement Pending Actions and Transactional ArchiveService

**Files:**
- Create: `src/archive/pending-actions.ts`
- Create: `src/archive/service.ts`
- Create: `src/archive/__tests__/pending-actions.test.ts`
- Create: `src/archive/__tests__/service.test.ts`

- [ ] **Step 1: Write failing idempotency and atomicity tests**

```ts
it('does not stage the same action twice', async () => {
  const store = new PendingArchiveActionStore(tmpDir);
  await store.stage(action);
  await store.stage(action);
  expect(await store.list()).toHaveLength(1);
});

it('preserves canonical files when candidate validation fails', async () => {
  const before = await readFile(indexPath, 'utf8');
  await expect(service.apply([invalidAcceptedAdrAction])).rejects.toThrow('accepted_adr_without_user_evidence');
  expect(await readFile(indexPath, 'utf8')).toBe(before);
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/archive/__tests__/pending-actions.test.ts src/archive/__tests__/service.test.ts
```

- [ ] **Step 3: Implement pending action persistence**

Store internal state under `memory/archive-actions.json`:

```ts
export interface PendingArchiveAction {
  key: string;
  taskId: string;
  type: 'create_adr' | 'update_adr' | 'accept_adr' | 'create_bug' | 'update_bug' | 'append_index';
  entityId?: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'applied' | 'failed';
  createdAt: string;
}
```

- [ ] **Step 4: Implement transaction flow**

`ArchiveService.apply()` must:

1. Discover and strictly read every source.
2. Clone the normalized model in memory.
3. Apply actions to the clone.
4. Validate the clone.
5. Serialize candidate text.
6. Reparse candidate text and validate again.
7. Write temporary sibling files.
8. Rename canonical Markdown atomically.
9. Render `dashboard.html` after canonical success.
10. Mark actions applied only after successful Markdown writes.

- [ ] **Step 5: Implement explicit service operations**

```ts
status(): Promise<ArchiveStatusResult>
init(): Promise<ArchiveBuildResult>
check(): Promise<ArchiveValidationResult>
build(): Promise<ArchiveBuildResult>
stage(action: PendingArchiveActionInput): Promise<PendingArchiveAction>
applyPending(taskId: string, evidence: ArchiveEvidence[]): Promise<ArchiveApplyResult>
acceptAdr(adrId: string, evidenceRef: string): Promise<ArchiveApplyResult>
```

- [ ] **Step 6: Run tests and commit**

```bash
npx vitest run src/archive/__tests__/pending-actions.test.ts src/archive/__tests__/service.test.ts
git add src/archive
git commit -m "feat(archive): apply idempotent transactional updates"
```

---

### Task 6: Add the Agent `archive_record` Tool

**Files:**
- Create: `src/core/pi-bridge/archive-tool.ts`
- Create: `src/core/pi-bridge/__tests__/archive-tool.test.ts`
- Modify: `src/core/pi-bridge/session-factory.ts`
- Modify: `src/core/pi-bridge/__tests__/session-factory.test.ts`

- [ ] **Step 1: Write failing tool tests**

```ts
it('stages a proposed ADR without accepting it', async () => {
  const tool = createArchiveRecordToolDefinition(tmpDir, { service });
  await tool.execute('call_1', {
    action: 'create_adr', title: 'Use adapter architecture', summary: 'Separate canonical data from HTML', taskId: 'task_1',
  });
  expect(await service.pending('task_1')).toContainEqual(expect.objectContaining({ type: 'create_adr' }));
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/core/pi-bridge/__tests__/archive-tool.test.ts src/core/pi-bridge/__tests__/session-factory.test.ts
```

- [ ] **Step 3: Implement the tool**

```ts
const schema = Type.Object({
  action: Type.Union([
    Type.Literal('create_adr'), Type.Literal('update_adr'), Type.Literal('create_bug'),
    Type.Literal('update_bug'), Type.Literal('append_index'),
  ]),
  taskId: Type.String(),
  entityId: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  summary: Type.String(),
  evidenceRefs: Type.Optional(Type.Array(Type.String())),
});
```

Prompt guidelines must say:

- Record only durable project knowledge.
- Never mark an ADR accepted.
- Never mark a bug FIXED without passed verification evidence.
- Do not create archive noise for trivial edits.

- [ ] **Step 4: Register the tool and verify inventory**

Add `createArchiveRecordToolDefinition(cwd)` to `customTools` only when `projectArchive` is enabled.

- [ ] **Step 5: Run tests and commit**

```bash
npx vitest run src/core/pi-bridge/__tests__/archive-tool.test.ts src/core/pi-bridge/__tests__/session-factory.test.ts
git add src/core/pi-bridge
git commit -m "feat(archive): let agents stage archive records"
```

---

### Task 7: Add `/archive` Slash Commands

**Files:**
- Create: `src/archive/commands.ts`
- Create: `src/archive/__tests__/commands.test.ts`
- Modify: `src/cli/command-parser.ts`
- Modify: `src/cli/__tests__/command-parser.test.ts`
- Modify: `src/extension/index.ts`

- [ ] **Step 1: Write failing parser tests**

```ts
expect(parseCommand('/archive status')).toEqual({ type: 'archive', subcommand: 'status' });
expect(parseCommand('/archive adr new Adapter architecture')).toEqual({
  type: 'archive', subcommand: 'adr-new', title: 'Adapter architecture',
});
expect(parseCommand('/archive bug update BUG-012 FIXED')).toEqual({
  type: 'archive', subcommand: 'bug-update', id: 'BUG-012', status: 'FIXED',
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/cli/__tests__/command-parser.test.ts src/archive/__tests__/commands.test.ts
```

- [ ] **Step 3: Extend the command union**

```ts
| { type: 'archive'; subcommand: 'status' | 'init' | 'check' | 'build' }
| { type: 'archive'; subcommand: 'adr-new'; title: string }
| { type: 'archive'; subcommand: 'bug-open'; title: string }
| { type: 'archive'; subcommand: 'bug-update'; id: string; status?: BugStatus }
```

Add completions and help text for all approved commands.

- [ ] **Step 4: Implement shared command execution**

```ts
export async function executeArchiveCommand(root: string, command: ArchiveSlashCommand): Promise<string> {
  const service = new ArchiveService({ root });
  switch (command.subcommand) {
    case 'status': return formatStatus(await service.status());
    case 'check': return formatValidation(await service.check());
    case 'build': return formatBuild(await service.build());
    case 'init': return formatBuild(await service.init());
    // explicit create/update paths stage or apply through the same service
  }
}
```

- [ ] **Step 5: Wire both TUI and readline switches**

Add identical `case 'archive'` behavior to both command loops in `src/extension/index.ts`. TUI uses `bridge.addMessage`/status; readline prints the returned text.

- [ ] **Step 6: Run tests and commit**

```bash
npx vitest run src/cli/__tests__/command-parser.test.ts src/archive/__tests__/commands.test.ts
git add src/archive src/cli src/extension/index.ts
git commit -m "feat(archive): add archive commands"
```

---

### Task 8: Integrate Technical Verification and ADR User Acceptance

**Files:**
- Create: `src/archive/workflow.ts`
- Create: `src/archive/__tests__/workflow.test.ts`
- Modify: `src/memory/tasks/types.ts`
- Modify: `src/memory/tasks/manager.ts`
- Modify: `src/memory/tasks/__tests__/manager.test.ts`
- Modify: `src/extension/index.ts`

- [ ] **Step 1: Write failing workflow tests**

```ts
it('keeps a verified ADR proposed until the user accepts it', async () => {
  await coordinator.applyAfterVerification(taskWithPassedVerification, [proposedAdrAction]);
  expect((await service.read()).adrs[0]).toMatchObject({
    decisionStatus: 'proposed', implementationStatus: 'verified',
  });
  expect(await tasks.getActive()).toMatchObject({ pending_archive_acceptance: { adrId: 'ADR-001' } });
});

it('records accepted only after an accepted natural review response', async () => {
  await coordinator.handleUserReview(task, '可以');
  expect((await service.read()).adrs[0].decisionStatus).toBe('accepted');
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/archive/__tests__/workflow.test.ts src/memory/tasks/__tests__/manager.test.ts
```

- [ ] **Step 3: Add task acceptance reference**

```ts
pending_archive_acceptance?: {
  adrId: string;
  requestedAt: string;
  evidenceRef: string;
};
```

Add manager methods to set and clear this value without changing unrelated workflow state.

- [ ] **Step 4: Apply pending actions after technical verification**

```ts
export async function finalizeArchiveForTask(task: Task, service: ArchiveService): Promise<ArchiveWorkflowResult> {
  const passed = task.verification_results.filter((item) => item.status === 'passed');
  const result = await service.applyPending(task.id, passed.map(toArchiveEvidence));
  const waiting = result.adrs.find((adr) => adr.implementationStatus === 'verified' && adr.decisionStatus === 'proposed');
  return { ...result, pendingAcceptance: waiting?.id };
}
```

- [ ] **Step 5: Reuse natural review detection**

When an active task has `pending_archive_acceptance`, route `accepted` to `service.acceptAdr()` and `revision_requested` to retained proposed status plus history feedback. Clear the pending reference only after persistence succeeds.

- [ ] **Step 6: Run tests and commit**

```bash
npx vitest run src/archive/__tests__/workflow.test.ts src/memory/tasks/__tests__/manager.test.ts
git add src/archive src/memory/tasks src/extension/index.ts
git commit -m "feat(archive): require user acceptance for ADRs"
```

---

### Task 9: Complete Conventional Writes, Docs, and Full Verification

**Files:**
- Modify: `src/archive/adapters/conventional-markdown.ts`
- Modify: `src/archive/__tests__/conventional-markdown.test.ts`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `.gitignore`

- [ ] **Step 1: Add round-trip tests for writable conventional formats**

Use fixtures with YAML frontmatter and bold metadata. Assert unrelated paragraphs, unknown frontmatter, headings, and manual history remain byte-identical outside targeted spans.

- [ ] **Step 2: Implement targeted span updates**

Only set `canWrite=true` when the adapter has unique source spans for ID, decision/bug status, implementation status, and history insertion. Otherwise remain read-only.

- [ ] **Step 3: Document behavior and commands**

README must explain:

- Markdown canonical / HTML derived.
- One-time initialization authorization.
- Automatic maintenance only for durable events.
- ADR acceptance requires explicit user approval.
- `/archive status|init|check|build|adr new|bug open|bug update`.

- [ ] **Step 4: Keep visual brainstorming artifacts ignored**

Ensure `.superpowers/` remains ignored. The committed design and plan are already force-added and must remain tracked.

- [ ] **Step 5: Run targeted archive suite**

```bash
npx vitest run src/archive src/core/pi-bridge/__tests__/archive-tool.test.ts src/cli/__tests__/command-parser.test.ts src/memory/tasks/__tests__/manager.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 6: Run full verification**

```bash
npm run build
npm test -- --run
python3 -m unittest tests/test_run_benchmark_comparison.py
npm run eval:validate
git diff --check
```

Expected: TypeScript build passes, the full Vitest suite passes with only the existing intentional skip, Python tests pass, deterministic eval validation passes, and diff check is clean.

- [ ] **Step 7: Smoke build the repository dashboard**

```bash
npx tsx scripts/build-dashboard.ts
file docs/dashboard.html
rg -n 'Project Health|ADR waiting for acceptance|OPEN bug|source-hash-state' docs/dashboard.html
```

Expected: UTF-8 HTML containing the selected health-overview surfaces.

- [ ] **Step 8: Commit**

```bash
git add src/archive src/core src/cli src/extension src/memory/tasks scripts/build-dashboard.ts README.md README.zh.md .gitignore docs/dashboard.html
git commit -m "feat: add project development archive workflow"
```

---

## Plan Self-Review Checklist

- Spec coverage: discovery, adoption, normalized models, lifecycle axes, user acceptance, bug evidence, INDEX, static HTML, search/filter/accessibility, failure handling, commands, workflow integration, and non-Node compatibility are each assigned to a task.
- Placeholder scan: no `TBD`, `TODO`, or unspecified “add tests/error handling” steps remain.
- Type consistency: `ArchiveConfig`, `ArchiveProject`, `ArchiveService`, `PendingArchiveAction`, ADR statuses, and bug statuses use the same names throughout.
- Scope: tasks form one dependent subsystem and are split into independently testable commits; the health dashboard becomes visible by Task 4 before workflow automation is complete.
