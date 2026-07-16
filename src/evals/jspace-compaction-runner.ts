import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvalFeatureManifest, EvalTaskDefinition } from './types.js';
import {
  createContextRuntimeBuildMemoryPrompt,
  seedContextRuntimeEvalMemory,
} from './context-runtime-runner.js';

export type JspaceCompactionArm = 'plain' | 'current';

export function buildJspaceFeatureManifest(arm: JspaceCompactionArm): EvalFeatureManifest {
  const current = arm === 'current';
  return {
    arm,
    piBuiltInCompaction: true,
    contextRuntime: current,
    memorySystemPrefix: current,
    taskLedgerModelInjection: current,
    recallModelInjection: current,
    checkpointInjection: false,
    jspaceInjection: false,
  };
}

export async function prepareJspaceArm(options: {
  arm: JspaceCompactionArm;
  task: EvalTaskDefinition;
  sandboxDir: string;
  instruction: string;
}): Promise<{
  featureManifest: EvalFeatureManifest;
  memoryDir?: string;
  buildMemoryPrompt?: () => Promise<string>;
}> {
  const featureManifest = buildJspaceFeatureManifest(options.arm);
  if (options.arm === 'plain') return { featureManifest };

  const memoryDir = join(options.sandboxDir, '.jspace-current-memory');
  await seedContextRuntimeEvalMemory({
    memoryDir,
    task: options.task,
    instruction: options.instruction,
  });
  return {
    featureManifest,
    memoryDir,
    buildMemoryPrompt: createContextRuntimeBuildMemoryPrompt('context_runtime', memoryDir),
  };
}

export function noOpNeutralityResult(input: {
  control: { status: 'success' | 'failed'; verifierScore: number };
  noOp: {
    status: 'success' | 'failed';
    verifierScore: number;
    compactionEvents: Array<{ boundary: string }>;
  };
}): {
  neutral: boolean;
  reason: string;
} {
  const neutral = input.control.status === 'success' &&
    input.noOp.status === 'success' &&
    input.control.verifierScore === input.noOp.verifierScore &&
    input.noOp.compactionEvents.length === 0;
  return neutral
    ? { neutral: true, reason: 'control and no-op verifier outcomes match without forced events' }
    : { neutral: false, reason: 'no-op run changed verifier behavior or emitted forced compaction events' };
}

export async function writeJspaceRunArtifacts(outputDir: string, artifacts: {
  featureManifest: EvalFeatureManifest;
  compactionEvents: unknown;
  usageEvents: unknown;
  toolTrace: unknown;
  verifierResult: unknown;
  sandboxPath?: string;
  model?: unknown;
  resultScope?: 'pipeline_only' | 'formal_eval';
}): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeJson(join(outputDir, 'feature-manifest.json'), artifacts.featureManifest),
    writeJson(join(outputDir, 'compaction-events.json'), artifacts.compactionEvents),
    writeJson(join(outputDir, 'usage-events.json'), artifacts.usageEvents),
    writeJson(join(outputDir, 'tool-trace.json'), artifacts.toolTrace),
    writeJson(join(outputDir, 'verifier-result.json'), artifacts.verifierResult),
    writeJson(join(outputDir, 'model.json'), artifacts.model ?? null),
    writeJson(join(outputDir, 'run.json'), {
      sandboxPath: artifacts.sandboxPath,
      result_scope: artifacts.resultScope ?? 'formal_eval',
    }),
  ]);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
