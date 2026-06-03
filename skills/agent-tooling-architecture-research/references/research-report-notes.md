# Research Report Notes

Use this file when translating agent research or engineering reports into architecture decisions.

## Anthropic: Demystifying Evals For AI Agents

Core concepts:

- **Task**: a concrete assignment.
- **Trial**: one stochastic attempt at a task.
- **Grader**: code, LLM, or human scoring.
- **Transcript/trace**: full trajectory including tool calls and observations.
- **Outcome**: final environment state, often more important than final answer.
- **Eval harness**: runs tasks, records traces, grades, and aggregates.
- **Agent harness**: the actual agent loop, model, prompts, and tools.

Engineering implications:

- Agent evals should measure the whole chain: model, prompt, tools, task manager, permissions, recovery, and final environment state.
- Distinguish runtime verification from eval. Runtime verification lets the agent test/fix while working; eval externally measures whether that loop is effective.
- Use deterministic graders where possible: tests, file state, command exit codes, tool-call policy checks.
- Add LLM/human graders for subjective quality, then calibrate them with human review.
- Include negative examples. If you only reward search when search is needed, the agent may search for everything.
- Start with a small set of real failures, often 20-50 tasks, before scaling.

## Research Integration Checklist

- Extract definitions, not just slogans.
- Convert each concept into a repo-level implication.
- Identify what can be deterministically graded.
- Identify what requires product/human judgment.
- Do not treat research recommendations as direct implementation requirements until mapped to current repo constraints.
