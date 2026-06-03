import { loadEvalTasks } from '../src/evals/task-loader.js';
import { createEvalSandbox, runSolution, runVerifier } from '../src/evals/sandbox.js';

async function main(): Promise<void> {
  const tasks = await loadEvalTasks();
  const results: Array<{ id: string; initial: number; solution?: number }> = [];

  for (const task of tasks) {
    const initialSandbox = await createEvalSandbox(task);
    try {
      const initial = await runVerifier(task, initialSandbox);
      if (initial.correctnessScore > 0) {
        throw new Error(`${task.id}: initial environment unexpectedly passes with score ${initial.correctnessScore}`);
      }
      results.push({ id: task.id, initial: initial.correctnessScore });
    } finally {
      await initialSandbox.cleanup();
    }

    if (task.solutionScriptPath) {
      const solutionSandbox = await createEvalSandbox(task);
      try {
        const solutionRun = await runSolution(task, solutionSandbox);
        if (solutionRun.exitCode !== 0) {
          throw new Error(`${task.id}: solution exited ${solutionRun.exitCode}\n${solutionRun.stderr}`);
        }
        const verified = await runVerifier(task, solutionSandbox);
        if (verified.correctnessScore < 1) {
          throw new Error(`${task.id}: solution verifier score ${verified.correctnessScore}\n${verified.stdout}\n${verified.stderr}`);
        }
        const row = results.find((item) => item.id === task.id);
        if (row) row.solution = verified.correctnessScore;
      } finally {
        await solutionSandbox.cleanup();
      }
    }
  }

  console.log(JSON.stringify({
    ok: true,
    task_count: tasks.length,
    results,
  }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
