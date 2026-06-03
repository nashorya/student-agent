"""Optional Inspect AI adapter for the local student-agent eval suite.

Run from the repository root after installing Inspect AI:

    inspect eval evals/inspect_student_agent.py

The TypeScript harness remains the source of truth. This adapter lets Inspect
orchestrate tasks while reusing `npm run eval:baseline -- --task <id>`.
"""

from __future__ import annotations

import json
import pathlib
import subprocess

from inspect_ai import Task, task
from inspect_ai.dataset import Sample
from inspect_ai.scorer import Score, Target, scorer
from inspect_ai.solver import Generate, TaskState, solver


ROOT = pathlib.Path(__file__).resolve().parents[1]
TASKS = ROOT / "evals" / "tasks"


@task
def student_agent_baseline() -> Task:
    samples = [
        Sample(id=task_dir.name, input=(task_dir / "instruction.md").read_text())
        for task_dir in sorted(TASKS.iterdir())
        if task_dir.is_dir()
    ]
    return Task(dataset=samples, solver=student_agent_solver(), scorer=student_agent_scorer())


@solver
def student_agent_solver():
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        result = subprocess.run(
            ["npm", "run", "eval:baseline", "--", "--task", str(state.sample_id)],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        state.output.completion = result.stdout if result.returncode == 0 else result.stderr
        return state

    return solve


@scorer
def student_agent_scorer():
    async def score(state: TaskState, target: Target) -> Score:
        try:
            parsed = json.loads(state.output.completion)
            record = parsed["records"][0]
            value = float(record["correctness_score"])
            explanation = json.dumps(record, ensure_ascii=False)
        except Exception as exc:  # pragma: no cover - depends on Inspect runtime
            value = 0.0
            explanation = f"Could not parse student-agent eval output: {exc}"
        return Score(value=value, explanation=explanation)

    return score
