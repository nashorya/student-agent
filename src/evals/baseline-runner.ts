import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadEvalTasks } from './task-loader.js';
import { createEvalSandbox, diffSnapshots, readChangedFileContents, runVerifier, snapshotFiles } from './sandbox.js';
import { runStudentAgentEval } from './agent-runner.js';
import { scoreEvalRun } from './scorer.js';
import type { EvalRunRecord } from './types.js';

export interface BaselineRunOptions {
  tasksRoot?: string;
  resultsDir?: string;
  taskIds?: string[];
  trials?: number;
  keepSandboxes?: boolean;
}

export async function runEvalBaseline(options: BaselineRunOptions = {}): Promise<EvalRunRecord[]> {
  const tasks = await loadEvalTasks(options.tasksRoot);
  const selected = options.taskIds?.length
    ? tasks.filter((task) => options.taskIds?.includes(task.id))
    : tasks;
  const missing = (options.taskIds ?? []).filter((id) => !tasks.some((task) => task.id === id));
  if (missing.length > 0) {
    throw new Error(`Unknown eval task id(s): ${missing.join(', ')}`);
  }

  const trials = options.trials ?? 1;
  const records: EvalRunRecord[] = [];
  for (const task of selected) {
    for (let trial = 1; trial <= trials; trial++) {
      const sandbox = await createEvalSandbox(task);
      try {
        const before = await snapshotFiles(sandbox.path);
        const trace = await runStudentAgentEval({ task, sandboxDir: sandbox.path });
        const afterAgent = await snapshotFiles(sandbox.path);
        const changedFiles = diffSnapshots(before, afterAgent);
        const modifiedFiles = await readChangedFileContents(sandbox.path, changedFiles);
        const verifier = await runVerifier(task, sandbox);
        const scored = scoreEvalRun({ task, trace, verifier, before, after: afterAgent, modifiedFiles });
        records.push({
          taskId: task.id,
          title: task.title,
          mode: task.mode,
          trial,
          ...scored,
        });
      } finally {
        if (!options.keepSandboxes) {
          await sandbox.cleanup();
        }
      }
    }
  }

  await writeBaselineReports(records, options.resultsDir);
  return records;
}

async function writeBaselineReports(records: EvalRunRecord[], resultsDir = resolve(process.cwd(), 'evals/results')): Promise<void> {
  await mkdir(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(join(resultsDir, `baseline-${stamp}.json`), JSON.stringify({ records }, null, 2), 'utf8');
  await writeFile(join(resultsDir, `baseline-${stamp}.md`), renderMarkdownReport(records), 'utf8');
}

function renderMarkdownReport(records: EvalRunRecord[]): string {
  const lines = [
    '# Student-Agent Eval Baseline',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Task | Mode | Trial | Outcome | Correctness | Behavior Diagnostic | Tools | Failed Tools | Duration ms |',
    '|---|---:|---:|---|---:|---:|---:|---:|---:|',
  ];
  for (const record of records) {
    lines.push([
      `| ${record.taskId}`,
      record.mode,
      String(record.trial),
      record.score.correctnessScore >= 1 ? 'passed' : 'failed',
      record.score.correctnessScore.toFixed(2),
      record.score.behaviorScore.toFixed(2),
      String(record.score.efficiencyMetrics.totalToolCalls),
      String(record.score.efficiencyMetrics.failedToolCalls),
      String(record.trace.durationMs),
    ].join(' | ') + ' |');
  }
  lines.push('', '## Findings', '');
  for (const record of records) {
    lines.push(`### ${record.taskId}`);
    if (record.score.behaviorFindings.length === 0) {
      lines.push('- No behavior findings recorded.');
    } else {
      for (const finding of record.score.behaviorFindings) {
        lines.push(`- ${finding}`);
      }
    }
    if (record.score.safetyMetrics.unexpectedChangedFiles.length > 0) {
      lines.push(`- Unexpected changed files: ${record.score.safetyMetrics.unexpectedChangedFiles.join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
