import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runStudentAgentEval } from '../src/evals/agent-runner.js';
import {
  noOpNeutralityResult,
  prepareJspaceArm,
  type JspaceCompactionArm,
  writeJspaceRunArtifacts,
} from '../src/evals/jspace-compaction-runner.js';
import { createEvalSandbox, runVerifier } from '../src/evals/sandbox.js';
import { loadEvalTask } from '../src/evals/task-loader.js';
import { TasksManager } from '../src/memory/tasks/manager.js';

interface CliOptions {
  taskDir: string;
  outputDir: string;
  arms: JspaceCompactionArm[];
  seeds: number;
  keepSandboxes: boolean;
  noOp: boolean;
  smoke: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const task = await loadEvalTask(resolve(options.taskDir));
  const instruction = await readFile(task.instructionPath, 'utf8');
  const boundaries = options.smoke ? [1] : [2, 4];
  const predeclaredTask = options.smoke ? {
    name: 'J-space recovery smoke',
    phases: [
      'Read protected constraints, run the one-time decoy, derive the migration conclusion, and emit PHASE_DONE.',
      'Use only the prior migration conclusion to update the target and verify protected constraints and no decoy retry.',
    ],
  } : undefined;
  const root = join(options.outputDir, new Date().toISOString().replace(/[:.]/g, '-'));
  const records: Array<Record<string, unknown>> = [];

  for (const arm of options.arms) {
    for (let seed = 1; seed <= options.seeds; seed++) {
      for (const mode of (options.noOp ? ['control', 'no-op'] : ['forced'])) {
        const sandbox = await createEvalSandbox(task);
        const runDir = join(root, `${arm}-seed-${seed}-${mode}`);
        try {
        const prepared = await prepareJspaceArm({
          arm,
          task,
          sandboxDir: sandbox.path,
          instruction,
        });
        const trace = await runStudentAgentEval({
          task,
          sandboxDir: sandbox.path,
          instruction,
          memoryDir: prepared.memoryDir,
          buildMemoryPrompt: prepared.buildMemoryPrompt,
          ...(mode === 'control' ? {} : {
            forceCompactionAfterPhases: mode === 'no-op' ? [] : boundaries,
          }),
          featureManifest: prepared.featureManifest,
          predeclaredTask,
          ...(options.smoke ? {
            maxModelCallsPerPhase: 8,
            maxWallClockMsPerPhase: 120_000,
          } : {}),
        });
        const verifier = await runVerifier(task, sandbox);
        const compactionEvents = trace.compactionEvents ?? [];
        const observedManifest = {
          ...prepared.featureManifest,
          observed: {
            contextAssemblyTraceCount: trace.contextAssemblyTraces?.length ?? 0,
            modelMemoryPromptInjected: (trace.contextAssemblyTraces?.length ?? 0) > 0,
          },
        };
        const compactionEvidence = mode === 'forced'
          ? {
            completed: boundaries.every((phase) => compactionEvents.some((event) =>
              event.boundary === `phase:${phase}` &&
              event.status === 'completed' &&
              event.productApi === 'AgentSession.compact' &&
              event.lifecycle.startObserved &&
              event.lifecycle.endObserved &&
              event.lifecycle.reason === 'manual')),
          }
          : undefined;
        await writeJspaceRunArtifacts(runDir, {
          featureManifest: observedManifest,
          compactionEvents,
          usageEvents: trace.usageEvents ?? [],
          toolTrace: trace.toolCalls,
          verifierResult: verifier,
          sandboxPath: options.keepSandboxes ? sandbox.path : undefined,
          model: trace.model,
          resultScope: options.smoke ? 'pipeline_only' : 'formal_eval',
        });
        if (compactionEvidence) {
          await writeFile(join(runDir, 'compaction-evidence.json'),
            `${JSON.stringify(compactionEvidence, null, 2)}\n`, 'utf8');
        }
        records.push({
          arm,
          seed,
          mode,
          traceStatus: trace.status,
          verifierScore: verifier.correctnessScore,
          compactionEvidence,
          compactionEvents,
          isolationValid: arm === 'plain'
            ? observedManifest.observed.contextAssemblyTraceCount === 0
            : observedManifest.observed.contextAssemblyTraceCount > 0,
          outputDir: runDir,
          sandboxPath: options.keepSandboxes ? sandbox.path : undefined,
        });
        } finally {
          TasksManager.resetInstance();
          if (!options.keepSandboxes) await sandbox.cleanup();
        }
      }
    }
  }

  await mkdir(root, { recursive: true });
  const neutralities = options.noOp ? options.arms.flatMap((arm) =>
    Array.from({ length: options.seeds }, (_, index) => {
      const seed = index + 1;
      const control = records.find((record) => record.arm === arm && record.seed === seed && record.mode === 'control')!;
      const noOp = records.find((record) => record.arm === arm && record.seed === seed && record.mode === 'no-op')!;
      return {
        arm,
        seed,
        result: noOpNeutralityResult({
          control: { status: control.traceStatus as 'success' | 'failed', verifierScore: control.verifierScore as number },
          noOp: {
            status: noOp.traceStatus as 'success' | 'failed',
            verifierScore: noOp.verifierScore as number,
            compactionEvents: noOp.compactionEvents as Array<{ boundary: string }>,
          },
        }),
      };
    })) : [];
  const healthy = records.every((record) =>
    record.traceStatus === 'success' && record.verifierScore === 1 && record.isolationValid === true);
  const forcedEvidence = records.filter((record) => record.mode === 'forced').every((record) =>
    (record.compactionEvidence as { completed?: boolean } | undefined)?.completed === true);
  const ok = healthy && (options.noOp
    ? neutralities.every((entry) => entry.result.neutral)
    : forcedEvidence);
  await writeFile(join(root, 'summary.json'), `${JSON.stringify({
    taskId: task.id,
    forcedCompactionAfterPhases: options.noOp ? [] : boundaries,
    records,
    neutralities,
    result_scope: options.smoke ? 'pipeline_only' : 'formal_eval',
  }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok, outputDir: root, records, neutralities }, null, 2));
  if (!ok) process.exitCode = 1;
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {
    taskDir: 'evals/tasks/jspace-compaction-probe-01',
    outputDir: 'evals/results/jspace-compaction',
    arms: [],
    seeds: 1,
    keepSandboxes: false,
    noOp: false,
    smoke: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--task-dir' && args[index + 1]) {
      parsed.taskDir = args[++index];
    } else if (arg === '--output-dir' && args[index + 1]) {
      parsed.outputDir = args[++index];
    } else if (arg === '--arm' && args[index + 1]) {
      parsed.arms.push(parseArm(args[++index]));
    } else if (arg === '--seeds' && args[index + 1]) {
      parsed.seeds = Number.parseInt(args[++index], 10);
    } else if (arg === '--keep-sandboxes') {
      parsed.keepSandboxes = true;
    } else if (arg === '--no-op') {
      parsed.noOp = true;
    } else if (arg === '--smoke') {
      parsed.smoke = true;
      parsed.taskDir = 'evals/tasks/jspace-recovery-smoke';
    } else {
      throw new Error(`Unknown eval:jspace-recovery argument: ${arg}`);
    }
  }
  if (parsed.arms.length === 0) parsed.arms = ['plain', 'current'];
  if (!Number.isInteger(parsed.seeds) || parsed.seeds <= 0) {
    throw new Error('--seeds must be a positive integer');
  }
  return parsed;
}

function parseArm(value: string): JspaceCompactionArm {
  if (value === 'plain' || value === 'current') return value;
  throw new Error(`Unsupported arm: ${value}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
