# student-agent

> **A true master is an eternal student.**

[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Eval Fixtures](https://img.shields.io/badge/eval%20fixtures-10%2F10%20validate-success)](evals/)

A CLI coding agent with memory, self-reflection, and a healthy awareness of its own limits. Built on [pi](https://github.com/badlogic/pi-mono), focused on programming tasks.

[中文文档 →](README.zh.md)

---

## Benchmark Results

Three-tier eval matrix (regression smoke / learning eval / external reference),
every run traceable to commit + model + pricing. June 2026 highlights:

- **2.6–4.1x lower token usage** than a heavyweight scaffold on the same model
  and tasks (SWE-bench Lite, historical internal reference; not a product
  comparison)
- **A 150-token standing rule moved cost 4–6x** — located by trace diff,
  fixed by a policy patch (−57% on the affected task, quality unchanged)
- **A 4-layer constraint-following case study** (terminal-bench
  `overfull-hbox`): from "constraint lost in assembly" to "scripted exhaustive
  self-verification", 3/3 seeds green, zero task-specific hacks
- **An honest NO-GO on cross-task memory gains**: memory on/off both 4/6 on an
  astropy task sequence — the recall pipeline works end-to-end, the quality
  benefit is not yet proven, and the root cause is located in the lesson
  write path. Prove first, then claim.
- Entire Sonnet 4.6 campaign: **$7.27** (cache probing, cost circuit breakers,
  invalid-run sentinels)

→ [Full report (zh)](docs/benchmark-report-2026-06.md) ·
[Learning-eval protocol](docs/adr/ADR-002-learning-eval-protocol.md) ·
[Claim discipline](docs/adr/ADR-001-eval-claim-separation.md)

---

## Table of Contents

- [Benchmark Results](#benchmark-results)
- [Getting Started](#getting-started)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Development Workflow](#development-workflow)
- [Testing & Eval](#testing--eval)
  - [Unit Tests](#unit-tests)
  - [Eval Harness Design](#eval-harness-design)
  - [Scoring System](#scoring-system)
  - [Task Catalogue](#task-catalogue)
  - [Running Evals](#running-evals)
  - [Interpreting Results](#interpreting-results)
- [Contributing](#contributing)
- [License](#license)

---

## Getting Started

### Prerequisites

- Node.js 20+
- Git

### Install

```bash
# 1. Clone this repo
git clone https://github.com/nashorya/student-agent.git
cd student-agent

# 2. Install dependencies (the pi SDK is pinned to reproducible npm packages)
npm install

# 3. Configure environment, or let first-run setup guide you
cp .env.example .env
# Edit .env, or run npm run dev and follow the setup prompts
```

### Minimum `.env`

```env
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Or OpenAI-compatible
STUDENT_AGENT_PROVIDER=openai
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...
STUDENT_AGENT_MODEL=gpt-4o
```

If no usable model key is found, first-run setup will guide you through provider selection, API format, optional Base URL, API key, and model selection. The setup writes local/global student-agent config so you do not have to edit every setting by hand.

### Run

```bash
# Development (TUI in TTY, readline fallback in CI/pipes)
npm run dev

# Or build and register globally
npm run build
npm link
student-agent          # run from any directory
```

Type a natural-language task and press Enter. The agent plans, executes, and reflects — you'll see each phase in the status bar. Use `/exit` or `Ctrl-C` to quit.

For benchmark harnesses or scripts, use non-interactive mode: `student-agent --prompt "fix the failing tests in this repository"`. Prefer `student-agent --prompt-file /path/to/instruction.md` for long instructions.

Useful slash commands:

| Command | Purpose |
|---|---|
| `/help` | Show available commands. |
| `/status` | Show current task/runtime status. |
| `/provider` | Switch a saved provider profile, including endpoint, API format, key reference, and model. |
| `/model` | Quickly switch model while keeping the current provider/API settings. |
| `/setting` or `/settings` | Create or replace a named provider profile, or configure embeddings. |
| `/task status` | Show active task details. |
| `/review up|ok|down` | Record quality feedback. |
| `/design study <url>` | Learn a visual style from a reference page when Design Study is enabled. |

### Optional: Playwright browser

Required only if `STUDENT_AGENT_FEATURE_PLAYWRIGHT=true` (default):

```bash
npx playwright install chromium
```

---

## Features

| Feature | Description |
|---|---|
| **Terminal UI** | Ink/React TUI with streaming output, status bar, and slash-command picker. Gracefully degrades to plain readline in non-TTY environments (CI, pipes). |
| **Layered Memory** | Learns preferences across sessions through dual channels: implicit (behavior observation via Reflect Agent) and explicit (user instruction). Versioned storage with provenance tracking. |
| **Bounded Breaker** | When generalizing patterns, actively generates known failure boundaries instead of blindly promoting rules. Confidence-scored reports surface uncertainty to the user. |
| **Failure Escalation** | Mutating operations snapshot first (git stash). On failure: rollback → retry with degraded strategy → inject web search → escalate with structured diagnosis. |
| **Risk Guard** | High-risk tool calls (delete, external API, DB write) require confirmation. Configurable exemptions via `project-rules.md`. |
| **Knowledge Retrieval** | Context7 for precise library docs, Playwright for JS-rendered pages with persistent login sessions. |
| **Design Study** | Visual style learner: captures StyleProfiles from reference URLs, self-critiques local implementations against them. |
| **Quality Watchdog** | Dual-signal degradation detection — user feedback prompts + background benchmark calibration. UI surfacing is still being stabilized. |
| **Sub-agent Orchestration** | Experimental concurrent sub-agents with write-intent conflict detection. Disabled by default. |
| **Task/Plan Workflow** | Progressive disclosure: simple tasks stay lightweight; complex multi-step work enters a full plan → execute → verify → user-accept loop. |

---

## Technology Stack

| Layer | Choice | Version | Reason |
|---|---|---|---|
| Runtime | Node.js / TypeScript | 20+ / 5.x | Consistent with existing toolchain |
| Base framework | [pi](https://github.com/badlogic/pi-mono) | 0.73.1 (pinned npm packages) | CLI REPL, tool dispatch, MCP client skeleton |
| LLM runtime | Pi SDK model registry | configurable | Uses Pi's `Model<Api>` registry; supports Anthropic and OpenAI-compatible providers. |
| Vector store | sqlite-vec | 0.1.9 | Zero dependencies, precompiled binary, cross-platform |
| MCP | @modelcontextprotocol/sdk | — | Standard protocol; Context7 and Web Search plug in directly |
| Web reader | Playwright + @mozilla/readability | 1.59.1 / 0.6.0 | JS-rendered pages, persistent login sessions |
| State machine | XState v5 | 5.x | Explicit state constraints, `after` timeouts, context holds IDs only |
| Concurrency | p-queue (WriteQueue singleton) | 9.x | SQLite serial writes, no lock contention |
| Terminal UI | Ink (React for terminal) | 5.x | Streaming render, status bar, slash-command input |
| Git snapshots | simple-git | 3.x | Low-overhead pre-execution snapshots and rollback |
| Test runner | Vitest | 2.x | Fast, ESM-native, co-located `__tests__/` |

---

## Architecture Overview

```
Input (natural language / URL / file path)
        │
        ▼
┌───────────────────────────────────┐
│           CORE AGENT              │
│  Planner → Executor → XState v5   │
│  Stream Adapter (buffer rounds)   │
│  Risk Guard + Snapshot hooks      │
└────────────┬──────────────────────┘
             │
     ┌───────┴────────┐
     ▼                ▼
Knowledge       Failure Escalation
Retrieval       ─────────────────
─────────       Attempt 1: rollback + retry
Context7        Attempt 2: web search inject
Playwright      Attempt 3: structured diagnosis
Design Study    → user question (questions.json)
             │
             ▼
     Layered Memory
     ─────────────
     project-rules.md          (highest priority, manual)
     preferences.md            (versioned, provenance-tagged)
     preference-candidates.json (trust state machine)
     questions.json            (failure case library)
     docs-index/               (sqlite-vec embeddings)
             │
             ▼
     Reflect Agent + Bounded Breaker (async)
     Quality Watchdog (background)
     Sub-agent Orchestrator (optional)
             │
             ▼
     TUI / Readline output
```

For the full design, see [`docs/student-agent-architecture-v0.32.md`](docs/student-agent-architecture-v0.32.md), [`docs/student-agent-task-plan-workflow.md`](docs/student-agent-task-plan-workflow.md), and [`docs/onboarding.md`](docs/onboarding.md).

---

## Project Structure

```
student-agent/
├── src/
│   ├── cli/            # Banner, command parser, event renderer, markdown
│   ├── core/           # Config, env, executor, state machine, task planner, write queue
│   ├── evals/          # Eval harness: agent runner, baseline runner, scorer, sandbox
│   ├── extension/      # Pi hooks (FileGuard, RiskGuard, Snapshot)
│   ├── knowledge/      # Context7, Playwright, Design Study, MCP schema validator
│   ├── memory/         # Candidates, design, docs-index, preferences, questions, tasks
│   ├── orchestrator/   # Sub-agent orchestration, Merge Agent
│   ├── reflect/        # Reflect Agent, Bounded Breaker
│   ├── tui/            # Ink components (App, InputLine, OutputArea, StatusBar)
│   ├── types/          # Shared TypeScript types
│   └── watchdog/       # Quality Watchdog
├── evals/
│   ├── tasks/          # Eval task definitions (instruction, environment, tests, solution)
│   ├── results/        # Baseline run outputs (git-ignored)
│   ├── product-rubric.md  # Grading calibration guide
│   └── README.md       # Eval harness reference
├── memory/             # Runtime memory files (git-ignored except project-rules.md)
├── docs/               # Architecture and workflow design docs
├── scripts/            # Eval harness scripts
└── bin/                # CLI entry point
```

---

## Configuration

All settings can be set in `.env` or `.student-agent.json`.

### Provider profiles

Interactive setup saves named provider profiles globally in
`~/.student-agent/.student-agent.json`. API key values stay in
`~/.student-agent/.env`; JSON stores only the key variable name.

```json
{
  "activeProviderProfile": "openrouter-sonnet",
  "providerProfiles": {
    "openrouter-sonnet": {
      "provider": "openrouter",
      "name": "anthropic/claude-sonnet-4.6",
      "baseUrl": "https://openrouter.ai/api/v1",
      "api": "openai-completions",
      "apiKeyEnv": "OPENROUTER_API_KEY"
    },
    "muskapi-sonnet": {
      "provider": "muskapi",
      "name": "claude-sonnet-4-6",
      "baseUrl": "https://api.muskapi.cc/v1",
      "api": "openai-completions",
      "apiKeyEnv": "MUSKAPI_API_KEY"
    }
  }
}
```

Use `/setting` to add profiles and `/provider` to switch the complete route.
`/model` changes only the active profile's model. A project can select a global
profile by placing `"activeProviderProfile": "profile-name"` in its local
`.student-agent.json`.

Legacy top-level `model` configuration remains supported. Environment variables
remain the highest-priority override for CI and eval runs. Set
`STUDENT_AGENT_PROVIDER_PROFILE` to select a profile non-interactively, or keep
using `STUDENT_AGENT_PROVIDER`, `STUDENT_AGENT_MODEL`,
`STUDENT_AGENT_BASE_URL`, and `STUDENT_AGENT_API` for a temporary route.

### Core settings

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required. Your Anthropic API key. |
| `STUDENT_AGENT_PROVIDER_PROFILE` | — | Select a named global provider profile. |
| `STUDENT_AGENT_PROVIDER` | `anthropic` | LLM provider (`anthropic` or OpenAI-compatible). |
| `STUDENT_AGENT_MODEL` | `claude-sonnet-4-6` | Model identifier. |
| `ANTHROPIC_BASE_URL` | — | Optional Anthropic-compatible relay/proxy URL. |
| `OPENAI_API_KEY` | — | Required when `STUDENT_AGENT_PROVIDER=openai`. |
| `OPENAI_BASE_URL` | — | Optional OpenAI Chat Completions-compatible endpoint. |
| `STUDENT_AGENT_MODEL_BASE_URL` | — | Provider-agnostic model Base URL override. |
| `STUDENT_AGENT_EXECUTION_MODE` | `yolo` | `yolo` = auto-run phases; `safe` = explicit confirmation gates. |

### Feature flags

| Flag | Default | Description |
|---|---|---|
| `STUDENT_AGENT_FEATURE_CONTEXT7` | `true` | Library documentation lookup via Context7 MCP. |
| `STUDENT_AGENT_FEATURE_PLAYWRIGHT` | `true` | JS-rendered page reading. |
| `STUDENT_AGENT_FEATURE_DESIGN_STUDY` | `true` | Visual style learning from reference URLs. |
| `STUDENT_AGENT_FEATURE_BOUNDED_BREAKER` | `true` | Confidence-scored pattern generalization. |
| `STUDENT_AGENT_FEATURE_QUALITY_WATCHDOG` | `true` | Passive quality degradation detection. |
| `STUDENT_AGENT_FEATURE_SUB_AGENTS` | `false` | Concurrent sub-agent orchestration. |

### High-risk operation exemptions

Create `memory/project-rules.md` and add a `[confirmation-exempt]` section:

```markdown
[confirmation-exempt]
- delete-file
- external-api
```

---

## Development Workflow

```bash
npm run dev          # Start agent (TUI in TTY, readline otherwise)
npm run build        # Compile TypeScript → dist/
npm test -- --run    # Run Vitest unit tests once
npm run eval:validate # Validate eval fixtures without model calls
```

Run `npm run build` after code changes — it catches type errors that tests don't cover. Run `npm test -- --run` before committing. Both must be clean before a PR.

---

## Testing & Eval

### Unit Tests

Unit tests live alongside source files in `__tests__/` directories and run with Vitest:

```bash
npm test -- --run
```

Tests cover configuration loading, executor logic, state machine transitions, memory managers, scorer heuristics, and more.

---

### Eval Harness Design

The eval system (`src/evals/`, `evals/`) is a purpose-built agent evaluation harness. Each task is a self-contained unit with four components:

| Component | Path | Purpose |
|---|---|---|
| Instruction | `instruction.md` | Natural-language prompt sent to the agent — identical to real user input |
| Environment | `environment/` | Starting file tree copied into a clean sandbox before each trial |
| Verifier | `tests/test.sh` | Shell script that checks outcomes deterministically — exit 0 = pass |
| Reference solution | `solution/solve.sh` | Known-working solution used by `eval:validate` to confirm the task is solvable |

**Environment isolation.** Each trial runs in a fresh sandbox directory. Shared state between runs (leftover files, cached data) would introduce correlated failures unrelated to agent performance. The harness takes before/after file snapshots to detect unexpected changes.

**Two execution modes** reflect real agent usage patterns:

- `direct` — the agent works without task lifecycle overhead. Used for mechanical file tasks.
- `task` — the agent uses the full TaskCreate/TaskUpdate workflow. The scorer verifies the task state reaches `completed`.

**Multiple trials surface non-determinism.** LLM outputs vary between runs. Use `--trials N` to run multiple trials on the same task. This supports two complementary reliability perspectives:

- **pass@k** — did at least one trial succeed? Useful when any correct solution is acceptable.
- **pass^k** — did every trial succeed? The stricter bar for user-facing reliability.

```bash
npm run eval:baseline -- --trials 5
```

---

### Scoring System

Each trial produces two scores that separate *what was produced* from *how the agent behaved* — a multi-grader approach that avoids conflating outcome quality with process quality.

#### `correctness_score` — primary, product-facing

Outcome-based. Set by the verifier script via one of:

- **Exit code** — exit 0 = `1.0`, non-zero = `0.0`
- **`reward.txt`** — a float in `[0, 1]` written by the verifier for partial credit
- **`reward.json`** — structured `{ "score": 0.8 }` format

If the agent modifies files outside `expected_files`, `correctness_score` is forced to `0` regardless of the verifier result. Scope violations are a hard failure.

#### `behavior_score` — diagnostic, engineering-facing

Transcript-based. Starts at `1.0` and decreases by `0.12` per finding. The scorer checks tool call traces for:

| Finding | What it catches |
|---|---|
| `edit mutated X before a matching read` | Missing read-before-edit discipline |
| `bash used for file read/search/list` | Using `bash cat/grep/find` instead of file tools |
| `edit retried the same failing arguments` | Looping without changing strategy |
| `task mode did not finish with completed task state` | Incomplete task lifecycle |
| `write overwrote N existing file(s)` | Clobbering files instead of editing |
| `unexpected changed file(s)` | Scope violation (also zeroes `correctness_score`) |

`behavior_score` is an **engineering diagnostic**, not a product gate. A task can pass with a sub-1.0 behavior score if the outcome is correct. See [`evals/product-rubric.md`](evals/product-rubric.md) for calibration guidance.

Safety metrics (dangerous bash commands, path escape attempts) are tracked separately and always surfaced in results.

---

### Task Catalogue

The suite covers both the behaviors that *should* occur and those that *should not*, avoiding one-sided optimization.

**Mechanical correctness** — judged primarily by `correctness_score`:

| Task | Tags | What it measures |
|---|---|---|
| `precise-edit` | `edit`, `read-before-edit` | Single-location file edit without touching surrounding content |
| `write-new-file` | `write` | Creating a new file from scratch |
| `multi-file-patch` | `edit`, `multi-file` | Coordinated changes across multiple files |
| `test-driven-bug` | `bash`, `edit` | Fix a bug guided by a verifier script |
| `search-before-read` | `grep`, `read` | Use search to locate the target before reading |
| `targeted-read-large-file` | `read`, `offset` | Offset reads on a large file — don't read everything |

**Strategy & experience** — judged by correctness + behavior diagnostics:

| Task | Tags | What it measures |
|---|---|---|
| `task-phase-flow` | `task-mode` | TaskCreate → execute → TaskUpdate lifecycle completion |
| `failure-recovery-edit-mismatch` | `edit`, `recovery` | Recover when an edit anchor is ambiguous or fails |
| `bash-timeout` | `bash`, `timeout` | Handle a hanging verifier script without freezing |
| `avoid-overwrite-existing` | `write`, `json` | Update a JSON file without clobbering existing keys |

**Fixture status:** all 10 tasks pass `eval:validate` (`initial: 0`, `solution: 1`). Model baselines depend on provider quota/network/model behavior; record the exact command and result when publishing a release.

---

### Running Evals

```bash
# Deterministic fixture validation — no model call, instant
npm run eval:validate

# Full model baseline run (all 10 tasks, 1 trial each)
npm run eval:baseline

# Run a single task
npm run eval:baseline -- --task precise-edit

# Run multiple trials (surfaces non-determinism)
npm run eval:baseline -- --trials 5

# Combine: 5 trials on one task
npm run eval:baseline -- --task task-phase-flow --trials 5
```

Results are written to `evals/results/` (git-ignored). Each result file contains the `correctness_score`, `behavior_score`, full `efficiencyMetrics`, `safetyMetrics`, `behaviorFindings`, and the complete `toolCalls` trace.

---

### Interpreting Results

**Read the transcripts.** A score alone doesn't tell you whether the agent made a genuine mistake or whether the grader rejected a valid solution. Examine the `toolCalls` array in result files when scores stall or a task unexpectedly fails.

**Failures should feel fair.** If a task fails, the trace should make it obvious what went wrong and why. A 0% pass rate across many trials almost always indicates a broken task specification — check `expected_files`, the verifier script, and the instruction for ambiguity before concluding the agent is at fault.

**Run `eval:validate` before `eval:baseline`.** Validation runs verifier scripts against reference solutions without any model call. If validation fails, the task is broken. Fix it before spending API budget.

**Watch for saturation.** As baseline scores approach 100%, the suite shifts from a *capability eval* (what can the agent do?) to a *regression suite* (does it still do what it used to?). Add harder tasks when the suite saturates to preserve a signal for improvement.

---

## Project Development Archive

Student Agent can maintain a project-owned development archive and render it as a static Project Health dashboard. Markdown remains the canonical source; HTML is deterministic derived output for people to browse, search, and filter.

Discovery starts at the project root passed to Student Agent. Explicit `archive` paths in `.student-agent.json` take precedence over conventional locations such as `docs/INDEX.md`, `docs/buglog.md`, and `docs/adr/`. When no archive exists, `/archive init` performs the one-time initialization. Conflicting conventional locations block writes instead of choosing silently.

```text
/archive status
/archive init
/archive check
/archive build
/archive adr new <title>
/archive bug open <title>
/archive bug update <BUG-ID> [status]
```

During task work, `archive_record` stages only durable decisions, bugs, and timeline events. Staged changes are applied after technical verification. An implemented ADR remains `proposed` with implementation status `verified`; it becomes `accepted` only after the user explicitly accepts the completed task. A bug cannot become `FIXED` without passed verification evidence.

Configuration defaults:

```json
{
  "features": { "projectArchive": true },
  "archive": {
    "enabled": true,
    "format": "auto",
    "dashboardPath": "docs/agent/dashboard.html"
  }
}
```

Set `STUDENT_AGENT_FEATURE_PROJECT_ARCHIVE=false` to remove the agent archive tool. Existing archives can still be inspected with the standalone commands.

---

## Contributing

Contributions are welcome. A few things to know before sending a PR:

**Read the architecture doc first.** [`docs/student-agent-architecture-v0.32.md`](docs/student-agent-architecture-v0.32.md) covers the provenance system, Bounded Breaker, and failure escalation ladder. PRs that bypass these invariants will be asked to revise.

**Type-check before submitting.** Run `npm run build` and fix all errors. The project enforces strict TypeScript throughout.

**Add or update evals for behavior changes.** If your PR changes agent behavior (tool selection, task lifecycle, memory writes), add a matching eval task or update an existing one. Each new task needs: `instruction.md`, `task.toml`, `environment/`, `tests/test.sh`, and optionally `solution/solve.sh`. Run `eval:validate` to confirm the task is solvable before submitting.

**Keep memory writes auditable.** Any new code writing to `memory/` must include a `provenance` field. Long-term memory writes require user confirmation — no silent auto-writes.

**Gate experimental features.** New capabilities that aren't ready for all users should be behind a `STUDENT_AGENT_FEATURE_*` flag.

**Commit message format:** `type(scope): description` in English. Common types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`.

---

## License

MIT
