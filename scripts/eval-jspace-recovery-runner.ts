import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runStudentAgentEval } from '../src/evals/agent-runner.js';
import {
  annotateCompactionPromptTokens,
  assessJspaceRunValidity,
  compareRunStructures,
  extractRunStructure,
  noOpNeutralityResult,
  prepareJspaceArm,
  summarizeBoundaryContextUsage,
  summarizeEffectiveParams,
  summarizeProviderTokenUsage,
  summarizeThinkingEvidence,
  type JspaceCompactionArm,
  type NeutralityMode,
  type RunStructure,
  writeJspaceRunArtifacts,
} from '../src/evals/jspace-compaction-runner.js';
import type { CompactionProbeEvent } from '../src/evals/forced-compaction-controller.js';
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
  controlOnly: boolean;
  smoke: boolean;
  neutralityMode: NeutralityMode;
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
  } : {
    name: 'APAC compatibility migration review',
    phases: [
      'Read the five small protected/current-state files with read_many, then independently read the four Phase 1 compliance ledgers and report the three CONTROL_MARKER values. Make no changes.',
      'Run scripts/legacy-migrate.sh exactly once; read the vendor response, migration map, and four Phase 2 audit ledgers; derive and report MIGRATION_DECISION; delete the vendor response, then verify its absence with a separate bash call; do not edit migration-config yet.',
      'Treat all Phase 1-2 materials as sealed: do not reread or globally search the vendor response, migration map, earlier ledgers, or their decision values. Without retrying the legacy helper, independently read the three Phase 3 rollout ledgers, then apply the Phase 2 MIGRATION_DECISION to src/migration-config.json with migrationVersion 2.',
      'Independently read the three Phase 4 release-readiness ledgers, then update src/runner.ts and append the three required ops-checklist lines verbatim. Do not change protected files.',
      'Run npx tsx src/runner.ts and verify its exact migration output, protected files, one-time input deletion, and that the rejected helper was not retried.',
    ],
  };
  const root = join(options.outputDir, new Date().toISOString().replace(/[:.]/g, '-'));
  const records: Array<Record<string, unknown>> = [];
  const runModes = options.controlOnly
    ? ['control'] as const
    : options.noOp
      ? ['control', 'no-op'] as const
      : ['forced'] as const;

  for (const arm of options.arms) {
    for (let seed = 1; seed <= options.seeds; seed++) {
      for (const mode of runModes) {
        const sandbox = await createEvalSandbox(task);
        const runDir = join(root, `${arm}-seed-${seed}-${mode}`);
        try {
        const prepared = await prepareJspaceArm({
          arm,
          task,
          sandboxDir: sandbox.path,
          instruction,
        });
        await mkdir(runDir, { recursive: true });
        const usageTimelinePath = join(runDir, 'usage-timeline.jsonl');
        await writeFile(usageTimelinePath, '', 'utf8');
        const trace = await runStudentAgentEval({
          task,
          sandboxDir: sandbox.path,
          instruction,
          memoryDir: prepared.memoryDir,
          buildMemoryPrompt: prepared.buildMemoryPrompt,
          ...(mode === 'control' ? {} : {
            forceCompactionAfterPhases: mode === 'no-op' ? [] : boundaries,
          }),
          observeCompactionAfterPhases: boundaries,
          featureManifest: prepared.featureManifest,
          predeclaredTask,
          providerUsageTimelinePath: usageTimelinePath,
          maxModelCallsPerPhase: 20,
          maxWallClockMsPerPhase: 600_000,
        });
        const verifier = await runVerifier(task, sandbox);
        const compactionEvents = trace.compactionEvents ?? [];
        annotateCompactionPromptTokens(compactionEvents, trace.providerUsageTimeline ?? []);
        const runStructure = extractRunStructure(trace, verifier);
        const thinkingEvidence = summarizeThinkingEvidence(trace.providerRequestAudit ?? []);
        const effectiveParams = summarizeEffectiveParams(trace.providerRequestAudit ?? []);
        const tokenUsage = summarizeProviderTokenUsage(
          trace.providerRequestAudit ?? [],
          trace.tokenUsage,
        );
        const contextVolume = summarizeBoundaryContextUsage(
          trace.providerRequestAudit ?? [],
          compactionEvents,
        );
        const runValidity = assessJspaceRunValidity(trace, boundaries, verifier, {
          requireEffectiveCompaction: mode === 'forced',
          rejectSealedMaterialReads: mode === 'forced',
        });
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
              event.kind === 'forced_compaction' &&
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
          providerRequestAudit: trace.providerRequestAudit,
          runStructure,
          thinkingEvidence,
          runValidity,
          effectiveParams,
          tokenUsage,
          contextVolume,
          compactionSummaries: trace.compactionSummaries,
          postCompactionPrompts: trace.postCompactionPrompts,
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
          runStatus: runValidity.status,
          verifierScore: verifier.correctnessScore,
          compactionEvidence,
          compactionEvents,
          runStructure,
          thinkingEvidence,
          runValidity,
          effectiveParams,
          tokenUsage,
          contextVolume,
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
  const calibrations = options.arms.map((arm) => {
    const controls = records
      .filter((record) => record.arm === arm &&
        record.mode === 'control' &&
        (record.runValidity as { valid?: boolean }).valid === true)
      .sort((left, right) => Number(left.seed) - Number(right.seed));
    const reference = controls[0];
    const comparisons = reference ? controls.slice(1).map((candidate) => ({
      referenceSeed: reference.seed,
      candidateSeed: candidate.seed,
      result: reference.traceStatus === 'success' && candidate.traceStatus === 'success'
        ? compareRunStructures(
          options.neutralityMode,
          reference.runStructure as RunStructure,
          candidate.runStructure as RunStructure,
        )
        : {
          neutral: false,
          mode: options.neutralityMode,
          failedOn: 'runStatus' as const,
          control: reference.traceStatus,
          noOp: candidate.traceStatus,
          reason: 'control calibration runs must both complete successfully',
        },
    })) : [];
    return {
      arm,
      mode: options.neutralityMode,
      stable: comparisons.length === 0 ? null : comparisons.every((entry) => entry.result.neutral),
      comparisons,
      reason: comparisons.length === 0
        ? 'at least two control trials are required to calibrate provider variance'
        : comparisons.every((entry) => entry.result.neutral)
          ? 'control replicates satisfy the requested structure threshold'
          : 'control replicates diverge before any no-op attribution is possible',
    };
  });
  const neutralities = options.noOp ? options.arms.flatMap((arm) =>
    Array.from({ length: options.seeds }, (_, index) => {
      const seed = index + 1;
      const control = records.find((record) => record.arm === arm && record.seed === seed && record.mode === 'control')!;
      const noOp = records.find((record) => record.arm === arm && record.seed === seed && record.mode === 'no-op')!;
      const calibration = calibrations.find((entry) => entry.arm === arm)!;
      const controlValidity = control.runValidity as { valid: boolean; status: 'complete' | 'incomplete' | 'aborted' | 'compaction_ineffective' | 'invalid_probe_leakage' };
      const noOpValidity = noOp.runValidity as { valid: boolean; status: 'complete' | 'incomplete' | 'aborted' | 'compaction_ineffective' | 'invalid_probe_leakage' };
      const pairResult = noOpNeutralityResult({
        mode: options.neutralityMode,
        control: {
          status: controlValidity.valid ? 'success' : controlValidity.status,
          structure: control.runStructure as RunStructure,
        },
        noOp: {
          status: noOpValidity.valid ? 'success' : noOpValidity.status,
          structure: noOp.runStructure as RunStructure,
          compactionEvents: noOp.compactionEvents as CompactionProbeEvent[],
        },
      });
      return {
        arm,
        seed,
        excluded: !controlValidity.valid || !noOpValidity.valid,
        pairResult,
        result: calibration.stable === false
          ? {
            neutral: false,
            mode: options.neutralityMode,
            inconclusive: true,
            failedOn: 'baselineVariance' as const,
            control: calibration.comparisons,
            noOp: pairResult,
            reason: 'control replicates are unstable; no-op effect is not identifiable',
          }
          : pairResult,
      };
    })) : [];
  const healthy = records.every((record) =>
    record.traceStatus === 'success' &&
    (record.runValidity as { valid?: boolean }).valid === true &&
    record.verifierScore === 1 &&
    record.isolationValid === true &&
    (record.effectiveParams as { consistent?: boolean }).consistent === true &&
    (record.thinkingEvidence as { thinkingActive?: boolean }).thinkingActive === true &&
    (options.smoke ||
      (record.contextVolume as { allWithinTarget?: boolean }).allWithinTarget === true));
  const forcedEvidence = records.filter((record) => record.mode === 'forced').every((record) =>
    (record.compactionEvidence as { completed?: boolean } | undefined)?.completed === true);
  const ok = healthy && (options.noOp
    ? neutralities.every((entry) => entry.result.neutral)
    : forcedEvidence);
  const thinking = {
    activeInEveryRun: records.every((record) =>
      (record.thinkingEvidence as { thinkingActive?: boolean }).thinkingActive === true),
    perRun: records.map((record) => ({
      arm: record.arm,
      seed: record.seed,
      mode: record.mode,
      ...(record.thinkingEvidence as Record<string, unknown>),
    })),
  };
  const rerunRequired = records
    .filter((record) => (record.runValidity as { valid?: boolean }).valid !== true)
    .map((record) => ({
      arm: record.arm,
      seed: record.seed,
      mode: record.mode,
      runValidity: record.runValidity,
    }));
  const effectiveParams = {
    pinnedInEveryRun: records.every((record) =>
      (record.effectiveParams as { consistent?: boolean }).consistent === true),
    perRun: records.map((record) => ({
      arm: record.arm,
      seed: record.seed,
      mode: record.mode,
      ...(record.effectiveParams as Record<string, unknown>),
    })),
  };
  const tokenUsage = summarizeRunTokenUsage(records);
  const contextVolume = {
    targetMetInEveryRun: options.smoke ? null : records.every((record) =>
      (record.contextVolume as { allWithinTarget?: boolean }).allWithinTarget === true),
    perRun: records.map((record) => ({
      arm: record.arm,
      seed: record.seed,
      mode: record.mode,
      ...(record.contextVolume as Record<string, unknown>),
    })),
  };
  await writeFile(join(root, 'summary.json'), `${JSON.stringify({
    taskId: task.id,
    seedSemantics: 'repeat_index_not_provider_seed',
    forcedCompactionAfterPhases: records.some((record) => record.mode === 'forced') ? boundaries : [],
    limits: {
      maxModelCallsPerPhase: 20,
      maxWallClockMsPerPhase: 600_000,
    },
    records,
    calibrations,
    neutralities,
    thinking,
    effectiveParams,
    tokenUsage,
    contextVolume,
    rerunRequired,
    neutralityMode: options.neutralityMode,
    result_scope: options.smoke ? 'pipeline_only' : 'formal_eval',
  }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok,
    outputDir: root,
    thinking,
    effectiveParams,
    tokenUsage,
    contextVolume,
    rerunRequired,
    records,
    neutralities,
  }, null, 2));
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
    controlOnly: false,
    smoke: false,
    neutralityMode: 'tolerant',
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
    } else if (arg === '--control-only') {
      parsed.controlOnly = true;
    } else if (arg === '--smoke') {
      parsed.smoke = true;
      parsed.taskDir = 'evals/tasks/jspace-recovery-smoke';
    } else if (arg === '--neutrality' && args[index + 1]) {
      parsed.neutralityMode = parseNeutralityMode(args[++index]);
    } else {
      throw new Error(`Unknown eval:jspace-recovery argument: ${arg}`);
    }
  }
  if (parsed.arms.length === 0) parsed.arms = ['plain', 'current'];
  if (!Number.isInteger(parsed.seeds) || parsed.seeds <= 0) {
    throw new Error('--seeds must be a positive integer');
  }
  if (parsed.noOp && parsed.controlOnly) {
    throw new Error('--no-op and --control-only cannot be used together');
  }
  return parsed;
}

function summarizeRunTokenUsage(records: Array<Record<string, unknown>>): Record<string, unknown> {
  const perRun = records.map((record) => ({
    arm: record.arm,
    seed: record.seed,
    mode: record.mode,
    ...(record.tokenUsage as Record<string, unknown>),
  }));
  const numeric = (record: Record<string, unknown>, key: string): number => {
    const usage = record.tokenUsage as Record<string, unknown> | undefined;
    return typeof usage?.[key] === 'number' ? usage[key] as number : 0;
  };
  const nullableSum = (key: string): number | null => {
    const values = records.map((record) => {
      const usage = record.tokenUsage as Record<string, unknown> | undefined;
      return usage?.[key];
    }).filter((value): value is number => typeof value === 'number');
    return values.length > 0
      ? Math.round(values.reduce((sum, value) => sum + value, 0) * 1_000_000) / 1_000_000
      : null;
  };
  return {
    totals: {
      promptTokens: records.reduce((sum, record) => sum + numeric(record, 'promptTokens'), 0),
      cachedPromptTokens: records.reduce((sum, record) => sum + numeric(record, 'cachedPromptTokens'), 0),
      uncachedPromptTokens: records.reduce((sum, record) => sum + numeric(record, 'uncachedPromptTokens'), 0),
      completionTokens: records.reduce((sum, record) => sum + numeric(record, 'completionTokens'), 0),
      reasoningTokens: records.reduce((sum, record) => sum + numeric(record, 'reasoningTokens'), 0),
      totalTokens: records.reduce((sum, record) => sum + numeric(record, 'totalTokens'), 0),
      peakPromptTokens: records.reduce((peak, record) =>
        Math.max(peak, numeric(record, 'peakPromptTokens')), 0),
      estimatedCostUsd: nullableSum('estimatedCostUsd'),
      listPriceEquivalentCny: nullableSum('listPriceEquivalentCny'),
    },
    perRun,
  };
}

function parseNeutralityMode(value: string): NeutralityMode {
  if (value === 'strict' || value === 'tolerant') return value;
  throw new Error(`Unsupported neutrality mode: ${value}`);
}

function parseArm(value: string): JspaceCompactionArm {
  if (value === 'plain' || value === 'current') return value;
  throw new Error(`Unsupported arm: ${value}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
