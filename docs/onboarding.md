# Onboarding guide — student-agent

Welcome to the team. This guide gets you from zero to productive in one sitting. Read it top-to-bottom the first time; use it as a reference after that.

---

## Table of contents

- [What this project is](#what-this-project-is)
- [Environment setup](#environment-setup)
- [Run it for the first time](#run-it-for-the-first-time)
- [How the codebase is organized](#how-the-codebase-is-organized)
- [Key systems — mental model](#key-systems--mental-model)
- [Common development tasks](#common-development-tasks)
- [Testing and evals](#testing-and-evals)
- [Things that will trip you up](#things-that-will-trip-you-up)
- [Who owns what](#who-owns-what)

---

## What this project is

`student-agent` is a CLI coding agent built on top of [pi (badlogic/pi-mono)](https://github.com/badlogic/pi-mono). You give it a natural-language task and it plans, executes, reflects on what it did, and learns from the session.

The three things that distinguish it from a plain LLM wrapper:

1. **Layered memory** — it actually remembers how you work across sessions, through a trust state machine that prevents bad patterns from being promoted too quickly.
2. **Failure escalation** — instead of just failing, it snapshots before mutating, rolls back on failure, retries with a degraded strategy, and escalates to the user only as a last resort.
3. **Bounded Breaker** — when it spots a repeating pattern worth generalizing, it also generates known failure cases for that pattern, so it doesn't overgeneralize.

---

## Environment setup

### 1. Clone repos

```bash
git clone https://github.com/<org>/student-agent.git
cd student-agent

# pi-mono is a required local dependency — it must sit next to student-agent
git clone https://github.com/badlogic/pi-mono pi-mono
```

### 2. Node version

Node 20+ is required. Check with `node --version`. Use `nvm` or `fnm` if you need to switch:

```bash
nvm install 20
nvm use 20
```

### 3. Install dependencies

```bash
npm install
```

This also builds the native `canvas` and `sqlite-vec` binaries. It takes a minute on first run.

### 4. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in at minimum:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

Everything else has sensible defaults. For a full list of what each variable does, see the `.env.example` — every variable is commented.

### 5. Optional: Playwright browser

The agent uses Playwright to read JS-rendered pages. Install the browser once:

```bash
npx playwright install chromium
```

Skip this if you set `STUDENT_AGENT_FEATURE_PLAYWRIGHT=false` in `.env`.

### 6. Verify setup

```bash
tsc --noEmit   # should produce no errors
npm test       # all tests should pass
```

---

## Run it for the first time

```bash
npm run dev
```

If your terminal is a TTY (i.e. an interactive shell, not a pipe or CI), you'll get the full Ink TUI with a status bar and streaming output. In a non-TTY environment it degrades to plain readline automatically.

Try a simple task to confirm everything is wired up:

```
> add a comment to the top of src/core/env.ts explaining what it does
```

The agent should plan, read the file, edit it, and verify. You'll see each phase appear in the status bar.

**To exit:** `Ctrl-C` or type `/exit`.

---

## How the codebase is organized

```
src/
├── cli/            # Entry point rendering, command parsing, markdown formatting
├── core/           # The agent's core loop
│   ├── config/     # Config loading (.env + .student-agent.json merging)
│   ├── executor/   # Tool execution, risk classification, confirmation, snapshots
│   ├── i18n/       # Message templates and pattern matching
│   ├── pi-bridge/  # Adapter layer between student-agent and pi primitives
│   ├── setup/      # First-run initializer
│   ├── state-machine/  # XState v5 task lifecycle (planning → executing → verifying)
│   ├── task-planner/   # Planning prompt builder, intent classifier, phase signals
│   └── write-queue.ts  # Global singleton that serializes all SQLite writes
│
├── evals/          # Evaluation harness (see Testing and evals below)
├── extension/      # Pi extension hooks wired into the agent loop
│   └── hooks/      # FileGuard, RiskGuard, Snapshot, Reflect, Memory, QualityWatchdog
├── knowledge/      # External knowledge retrieval
│   ├── context7-client.ts      # Context7 MCP for library docs
│   ├── playwright-reader.ts    # JS-rendered page scraping
│   └── design-study/           # Visual style learner (StyleProfile extraction + critic)
├── memory/         # Persistent memory subsystems (each has manager + types + __tests__)
│   ├── candidates/     # preference-candidates.json — the trust pool
│   ├── design/         # Design StyleProfiles
│   ├── docs-index/     # sqlite-vec embeddings of project docs
│   ├── plan-revisions/ # History of plan changes mid-task
│   ├── preferences/    # preferences.md — promoted long-term rules
│   ├── project-kb/     # General project knowledge cache
│   ├── questions/      # Failure case library
│   ├── tasks/          # Task metadata (for cross-session continuity)
│   └── why/            # Decision provenance log
├── orchestrator/   # Sub-agent orchestration (disabled by default)
├── reflect/        # Reflect Agent + Bounded Breaker (async, post-session)
├── tui/            # Ink/React components: App, InputLine, OutputArea, StatusBar
├── types/          # Shared type declarations
└── watchdog/       # Quality Watchdog (background degradation detection)
```

The runtime memory files live in `memory/` at the repo root (not `src/memory/`). Most of it is git-ignored; only `project-rules.md` is committed.

---

## Key systems — mental model

### Task lifecycle (state machine)

Every non-trivial task goes through a fixed lifecycle managed by XState v5 in `src/core/state-machine/`:

```
idle → planning → executing (phase loop) → verifying → completed
                                ↕
                           (failure escalation)
```

Planning produces a `TASK_CONTEXT` block plus 2–5 phases. Each phase is executed independently. On failure, the escalation ladder runs before the task is aborted.

The planning prompt (`src/core/task-planner/planning-prompt.ts`) is intentionally constrained — the planner is only allowed to read up to 3 structural files and must not write any code. This keeps planning fast and forces good decomposition.

### Memory: the two channels

All long-term learning flows through two channels:

**Explicit channel** — the user says `/prefer always use named exports`. This writes directly to `preferences.md` via `PreferencesManager.addExplicit()`, bypassing the trust pool entirely.

**Implicit channel** — the Reflect Agent observes the session's git diff and task description after the fact, extracts patterns, and writes them to `preference-candidates.json`. A candidate must be observed multiple times and pass the Bounded Breaker's confidence threshold before it can be promoted to `preferences.md`.

Reading priority (highest to lowest):
1. `memory/project-rules.md` — manual overrides, always wins
2. `memory/preferences.md` — promoted implicit patterns
3. `memory/preference-candidates.json` — under-observation patterns (not yet applied)

### Failure escalation

Every mutating tool call (edit, write, apply_patch) is preceded by a git snapshot via `SnapshotManager`. On failure:

1. Roll back to the snapshot and retry with a degraded strategy
2. If retry fails, inject a web search for context and try again
3. If that fails, write a structured diagnosis to `memory/questions.json` and escalate to the user

You rarely need to touch this system, but when you do, look at `src/core/executor/snapshot.ts` and `src/extension/hooks/failure-escalation.ts`.

### Risk guard

Any tool call that matches the patterns in `src/core/executor/risk-classifier.ts` (deletes, external API calls, DB writes, `sudo`) requires explicit user confirmation before execution. The user can exempt specific tools by listing them in `memory/project-rules.md` under `[confirmation-exempt]`.

### Write queue

All SQLite writes go through `WriteQueue` — a `p-queue` singleton in `src/core/write-queue.ts`. This prevents concurrent writes from causing lock contention. If you add a new memory subsystem that writes to SQLite, route it through `WriteQueue.add()`.

### Reflect Agent and Bounded Breaker

`ReflectAgent` (`src/reflect/reflect-agent.ts`) runs asynchronously after each session ends. It:

1. Reads the session's git diff and task description
2. Calls `extractPatterns()` to identify repeating behaviors
3. Updates `preference-candidates.json` via `PreferenceCandidatesManager`
4. Promotes candidates that have passed the trust threshold to `preferences.md`

`BoundedBreaker` (`src/reflect/bounded-breaker.ts`) intercepts the promotion step. For each pattern being promoted, it generates known failure cases — situations where applying the rule would produce wrong behavior. If it finds any, it attaches them to the pattern's confidence report rather than blocking promotion outright.

---

## Common development tasks

### Add a new feature

1. Write the unit test first in the relevant `__tests__/` directory.
2. Implement in `src/`.
3. Run `tsc --noEmit` — fix all type errors before moving on.
4. Run `npm test` — all existing tests must still pass.
5. If the feature changes agent behavior (tool selection, task lifecycle, memory writes), add a matching eval task (see below).
6. Gate experimental features behind `STUDENT_AGENT_FEATURE_<NAME>` in `.env.example` and `.student-agent.example.json`.

### Add a new memory subsystem

Each memory subsystem lives in `src/memory/<name>/` and follows the same structure:

```
src/memory/<name>/
├── manager.ts     # The public API — read/write methods
├── types.ts       # TypeScript interfaces for the data format
└── __tests__/
    └── manager.test.ts
```

Rules:
- All writes go through `WriteQueue.add()`.
- Every write must include a `provenance` field (where did this value come from?).
- Long-term writes (anything that persists across sessions) must ask for user confirmation before writing — no silent auto-writes.
- Register your manager as a singleton (`static getInstance()`), same pattern as `PreferencesManager`.

### Add a new pi hook

Hooks live in `src/extension/hooks/`. A hook is a function that pi calls at specific points in the agent loop (before tool execution, after tool execution, on session end, etc.).

Look at an existing hook like `src/extension/hooks/risk-guard.ts` for the pattern. Register your hook in `src/extension/index.ts`.

### Change agent behavior

If you're changing how the agent plans, executes, or reflects — add or update an eval task before the PR. Run the baseline first to get a clean before:

```bash
npm run eval:baseline > evals/results/before.txt
# make your changes
npm run eval:baseline > evals/results/after.txt
diff evals/results/before.txt evals/results/after.txt
```

---

## Testing and evals

### Unit tests

```bash
npm test              # run all tests
npm test -- --watch   # watch mode during development
```

Tests live next to their source file in `__tests__/`. Vitest discovers them automatically.

### Eval harness

The eval suite lives in `evals/tasks/`. Each task is a self-contained scenario:

```
evals/tasks/<name>/
├── instruction.md   # the prompt sent to the agent
├── task.toml        # metadata (id, mode, timeout, expected_files)
├── environment/     # starting file tree (copied fresh for each trial)
├── tests/test.sh    # verifier — exit 0 = pass
└── solution/solve.sh  # optional reference solution
```

Running evals:

```bash
npm run eval:validate                          # fixture check, no model call
npm run eval:baseline                          # full run, all 10 tasks
npm run eval:baseline -- --task precise-edit   # single task
npm run eval:baseline -- --trials 3            # multiple trials
```

Results go to `evals/results/` (git-ignored).

**Adding a new eval task:**

1. Create `evals/tasks/<your-task>/` with the four files above.
2. Write `tests/test.sh` to check the outcome deterministically.
3. Write `solution/solve.sh` — a minimal bash script that produces a passing outcome without the agent.
4. Run `npm run eval:validate` — it runs your verifier against your reference solution. If it fails, your task or verifier is broken; fix it before running the full baseline.

See `evals/product-rubric.md` for how to interpret `correctness_score` vs `behavior_score`.

---

## Things that will trip you up

**`pi-mono` must be a sibling directory.** The `package.json` references it as `file:./pi-mono/packages/...`. If you clone `student-agent` without also cloning `pi-mono` next to it, `npm install` will fail with a module resolution error.

**`tsc --noEmit` after every change.** The project uses strict TypeScript. Type errors that don't show up at runtime will block your PR. Make it a habit before committing.

**`WriteQueue` is a singleton.** If you write a test that creates a `WriteQueue` and doesn't drain it, subsequent tests that touch the same queue will see stale state. Use `await WriteQueue.getInstance().onIdle()` in `afterEach` if your test enqueues writes.

**The planning prompt is in Chinese.** The internal planning prompt (`buildPlanningPrompt`) uses Chinese. This is intentional — it was developed that way and the LLM handles it correctly. Don't translate it; the prompts in tests that assert against planning output also use Chinese strings.

**Eval tasks run in a clean sandbox.** The harness copies `environment/` into a temp directory before each trial. Don't reference files from outside that directory in `tests/test.sh` — the paths won't exist in the sandbox.

**`behavior_score` is diagnostic, not a gate.** A task passing with `behavior_score: 0.76` is not a problem unless the rubric explicitly upgrades that finding to a hard gate. Check `evals/product-rubric.md` before treating behavior findings as blockers.

**Memory files are mostly git-ignored.** `memory/preferences.md`, `memory/preference-candidates.json`, and the rest are local to your machine. Only `memory/project-rules.md` is committed. If you're debugging a memory issue, the files live at the repo root under `memory/`.

---

## Who owns what

| Area | Where to look first |
|---|---|
| Core agent loop | `src/core/state-machine/`, `src/core/task-planner/` |
| Memory system | `src/memory/` — each subsystem has its own directory |
| Failure escalation | `src/extension/hooks/failure-escalation.ts`, `src/core/executor/snapshot.ts` |
| Reflect Agent | `src/reflect/reflect-agent.ts` |
| Bounded Breaker | `src/reflect/bounded-breaker.ts` |
| Eval harness | `src/evals/`, `evals/tasks/` |
| TUI | `src/tui/` |
| Knowledge retrieval | `src/knowledge/` |
| Sub-agent orchestration | `src/orchestrator/` |
| Architecture deep-dive | `docs/student-agent-architecture-v0.31.md` |
| Task/plan workflow | `docs/student-agent-task-plan-workflow.md` |
| Eval rubric | `evals/product-rubric.md` |

When in doubt, read the architecture doc. It covers the provenance system, Bounded Breaker internals, failure escalation ladder, and Stream Adapter in detail. Most design questions are answered there.
