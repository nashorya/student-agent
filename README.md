# student-agent

> **A true master is an eternal student.**

A CLI coding agent with memory, self-reflection, and a healthy awareness of its own limits. Built on [pi](https://github.com/badlogic/pi-mono), focused on programming tasks.

[中文版 README](README.zh.md)

---

## Features

- **TUI Interface** — Ink/React terminal UI with streaming output, status bar, and command history. Gracefully degrades to plain readline in non-TTY environments (CI, pipes).
- **Memory & Reflection** — Learns from repeated patterns across sessions. Promotes validated preferences through a trust state machine; never auto-writes architecture-scope changes without confirmation.
- **Failure Escalation** — Every execution is preceded by a git snapshot. On failure: rollback → retry with degraded strategy → escalate to user.
- **Knowledge Retrieval** — Context7 for precise library documentation, optional Playwright for dynamic web pages.
- **Quality Watchdog** — Passive degradation detection across sessions. Silent footer indicator, no full-screen interruptions.
- **Orchestrator** — Concurrent sub-agent scheduling with write-intent conflict detection and git worktree isolation.

## Prerequisites

- Node.js 20+
- The upstream `pi-mono` repo cloned locally:

```bash
git clone https://github.com/badlogic/pi-mono pi-mono
```

## Quick Start

```bash
# 1. Clone
git clone <this-repo> student-agent
cd student-agent

# 2. Clone pi-mono dependency
git clone https://github.com/badlogic/pi-mono pi-mono

# 3. Install
npm install

# 4. Configure
cp .env.example .env
# Edit .env — at minimum set ANTHROPIC_API_KEY
```

**Minimum `.env` required:**

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `ANTHROPIC_BASE_URL` | Leave blank unless using a proxy |

```bash
# 5. Register as a global CLI command
npm link

# 6. Run from any directory
student-agent
```

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start agent (TUI in TTY, plain REPL otherwise) |
| `npm run build` | Compile TypeScript |
| `npm test` | Run Vitest tests |
| `tsc --noEmit` | Type-check (run after every code change) |

## Configuration

Runtime behavior can be tuned via `.env` or `.student-agent.json`. Key feature flags:

| Flag | Default | Description |
|---|---|---|
| `STUDENT_AGENT_FEATURE_CONTEXT7` | `true` | Library documentation lookup |
| `STUDENT_AGENT_FEATURE_PLAYWRIGHT` | `true` | Dynamic web page reading |
| `STUDENT_AGENT_FEATURE_DESIGN_STUDY` | `true` | Visual style learning from reference pages and local UI critique |
| `STUDENT_AGENT_FEATURE_BOUNDED_BREAKER` | `true` | Pattern generalization with confidence scoring |
| `STUDENT_AGENT_FEATURE_QUALITY_WATCHDOG` | `true` | Passive quality degradation detection |
| `STUDENT_AGENT_FEATURE_SUB_AGENTS` | `false` | Concurrent sub-agent orchestration |

If Playwright browsers are not installed yet:

```bash
npx playwright install chromium
```

## Architecture

```
Input → Core Agent (Planner → Executor → State Machine)
             ↓                    ↓
      Knowledge Retrieval   Failure Escalation
      (Context7, Playwright) (snapshot → rollback → retry)
             ↓
      Memory Layer (preferences, candidates, reflect agent)
             ↓
      TUI (Ink/React status bar + streaming output)
```

See [`docs/student-agent-architecture-v0.3.md`](docs/student-agent-architecture-v0.3.md) for the full design.

## License

MIT
