---
name: agent-tooling-architecture-research
description: Use when diagnosing, redesigning, or planning changes to a coding-agent tool system, task-management system, tool runtime, eval baseline, sandbox/permission model, or bash/read/edit/write workflow. Trigger when the user says tools are hard to use, "tool不好用", "task管理混乱", bash/edit/write/read are inefficient or error-prone, asks whether to add tools or modify tools, asks to study source code before implementation, asks to compare well-known open-source agent/coding-agent projects, asks to read authoritative engineering reports or papers from Anthropic/OpenAI/Google/universities, asks about agent evals, or wants a plan before refactoring tool/task architecture. Guides Codex to inspect the current repo first, select primary references, separate source facts from inferred principles, produce a gap/decision matrix, build eval baselines before refactors, and reserve product rubric calibration for after baseline results.
---

# Agent Tooling Architecture Research

## Core Rule

Do not redesign tools or task management from vibes. First establish repo truth, then compare primary references, then decide whether to add tools, modify tools, introduce a tool runtime, improve task management, or build an eval baseline.

## Workflow

1. **Ground Current System**
   Inspect the current repo before asking design questions. Locate tool registration, bash/read/edit/write implementations, task state, permission hooks, transcript/logging, tests, and package scripts.

2. **Select References**
   Use user-provided references first. Add well-known open-source projects or primary research only when they directly illuminate the current problem. Prefer source code, official docs, engineering blogs, university/benchmark papers, and benchmark repos over commentary.
   Read `references/reference-selection-policy.md` when the reference set is not obvious.

3. **Study Sources**
   Capture source-observed facts separately from inferred principles and recommendations. For coding-agent source comparisons, read `references/source-study-notes.md` for the dimensions to inspect and the prior study notes from this project.

4. **Integrate Research**
   Translate reports or papers into engineering constraints and eval implications. Read `references/research-report-notes.md` when discussing agent evals, tool use, verifier loops, or external research.

5. **Produce a Decision Matrix**
   Decide whether the problem calls for new tools, changed tools, a unified runtime, task-registry work, eval baseline work, or no change yet. Use `references/gap-decision-matrix.md`.

6. **Build Baseline Before Refactor**
   If implementation is likely, create or update eval baselines before changing behavior. Use `references/eval-baseline-patterns.md`.

7. **Calibrate With Product Judgment**
   Do not set pass/fail thresholds or scorer weights unilaterally. After baseline transcripts exist, ask the user to classify failures as P0/P1/P2 and update the rubric. Use `references/product-rubric-calibration.md`.

## Output Expectations

- State what was observed in the repo.
- State which references were consulted and why.
- Separate facts, inferences, and recommendations.
- Include a compact gap/decision matrix for substantial architecture work.
- If proposing implementation, include eval/baseline implications and product-calibration checkpoints.
- Do not mutate files unless the user explicitly asks for implementation.
