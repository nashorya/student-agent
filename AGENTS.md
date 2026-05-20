# Repository Guidelines

## Project Structure & Module Organization

This TypeScript, Node.js, XState v5 CLI coding agent builds on local `pi-mono` packages. Treat `docs/student-agent-architecture-v0.3.md` as the primary architecture document.

- `src/core/state-machine/`: XState machine, Stream Adapter, resources, diagnostics, and types.
- `src/core/executor/`: confirmation, risk classification, and snapshot rollback.
- `src/core/task-planner/`: task/phase signal parsing and planning prompts.
- `src/extension/hooks/`: Pi before/after hooks such as file guard, risk guard, snapshot, memory, and failure escalation.
- `src/tui/`: Ink/React terminal UI.
- `src/reflect/`: reflection and bounded-breaker logic.
- `src/knowledge/`: Context7, Playwright, and design-study retrieval.
- `src/memory/questions/`: `questions.json` access through managers.
- `src/**/__tests__/`: colocated Vitest tests.
- `memory/`: runtime memory files; access only through the appropriate Manager.
- `docs/`: architecture documents.
- `pi-mono/`: upstream pi source. Do not modify it; import its APIs only.

## Build, Test, and Development Commands

- `npm run dev`: run the interactive CLI in development mode.
- `npm run build`: compile TypeScript.
- `npm test`: run Vitest tests.
- `tsc --noEmit`: type-check after code changes; do not leave type errors.

## Coding Style & Naming Conventions

Use ES modules, strict TypeScript, two-space indentation, single quotes, and semicolons. Relative imports should include emitted `.js` extensions.

Do not use `any`; use `unknown` plus narrowing. Async functions must handle failures. Split functions beyond about 40 lines. Use `PascalCase` for classes/types and `camelCase` for values.

## Architecture Constraints

Keep XState context limited to IDs and flags; resource instances belong in `ResourceManager`. `Stream Adapter` is the only bridge between Anthropic streaming output and XState events. Use XState `after(120000)` for timeouts.

SQLite writes must go through singleton `WriteQueue`. Files under `memory/` must be accessed only through Manager classes. Mutating executor worktree changes require a git snapshot first. High-risk tool calls must pass through RiskGuard confirmation before snapshot creation.

## Testing Guidelines

Use Vitest with `*.test.ts` files in nearby `__tests__` directories. File parallelism is disabled because snapshot tests use real git repositories. Cover rollback, state transitions, stream adaptation, and memory managers.

## Commit & Pull Request Guidelines

Recent commits use `feat:` and `fix(scope):`, often with step markers or Chinese descriptions. Keep messages action-oriented, for example `feat(executor): add rollback diagnostics`.

Pull requests should summarize the change, identify the active phase, list checks run, and call out effects on snapshots, confirmation, memory, or `pi-mono` contracts.

## Forbidden Actions

Do not modify `memory/project-rules.md`. Do not log or persist Playwright cookies. Do not add external dependencies outside the architecture docs without confirmation. Do not implement multiple modules at once or skip to phase-three features.

If an architecture question arises, stop and present two or three options with tradeoffs before changing code.
