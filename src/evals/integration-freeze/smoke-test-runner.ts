import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createContextAssemblyHook } from '../../extension/hooks/context-assembly.js';
import { HarnessChangeManager } from '../../memory/harness-change/index.js';
import { ContextBuilder } from '../../memory/recall/context-builder.js';
import { JsonlMemoryStore } from '../../memory/recall/jsonl-memory-store.js';
import { RecallRouter } from '../../memory/recall/recall-router.js';
import { RunArchiveWriter, extractWorkingMemorySnapshot } from '../../memory/run-archive/index.js';
import { detectLostness } from '../../memory/signals/index.js';
import type { TaskWorkingMemory } from '../../memory/tasks/types.js';
import type { RecallBundle } from '../../memory/recall/types.js';
import type { SmokeTestResult } from './types.js';

export async function runSmokeTest(memoryDir: string): Promise<SmokeTestResult> {
  const components: SmokeTestResult['components'] = [];

  await check(components, 'JsonlMemoryStore.search', async () => {
    const store = new JsonlMemoryStore({ memoryDir });
    await store.search({});
  });

  await check(components, 'RecallRouter.recall', async () => {
    const router = new RecallRouter(new JsonlMemoryStore({ memoryDir }));
    const bundle = await router.recall({
      taskId: 'task_smoke',
      phase: 'executing',
      goal: 'Smoke test recall router',
      currentStep: 'Build recall bundle',
      recentErrors: [],
      recentSignals: [],
      recentRawTurns: [],
    });
    if (!bundle.diagnostics) throw new Error('Recall bundle diagnostics missing');
  });

  await check(components, 'ContextBuilder.build', async () => {
    const built = new ContextBuilder().build({
      workingMemory: minimalWorkingMemory(),
      recallBundle: emptyRecallBundle(),
    });
    if (built.sections.length === 0) throw new Error('Built context has no sections');
  });

  await check(components, 'RunArchiveWriter', async () => {
    const writer = new RunArchiveWriter({ memoryDir });
    await writer.startRun('task_smoke', 'run_smoke');
    await writer.appendEvent('run_smoke', {
      timestamp: new Date().toISOString(),
      kind: 'tool_call',
      summary: 'Smoke event',
      toolName: 'smoke',
    });
    const outcome = await writer.finalizeRun('run_smoke', {
      taskId: 'task_smoke',
      status: 'success',
      finalSummary: 'Smoke run finalized',
      wmSnapshot: extractWorkingMemorySnapshot(minimalWorkingMemory(), 'task_smoke', 'run_smoke'),
    });
    if (outcome.runId !== 'run_smoke') throw new Error('Unexpected smoke outcome runId');
    if (!outcome.wmSnapshot) throw new Error('Smoke outcome missing working memory snapshot');
  });

  await check(components, 'HarnessChangeManager.create', async () => {
    const manager = new HarnessChangeManager({ memoryDir });
    const change = await manager.create({
      targetComponent: 'integration-freeze',
      rationale: 'Smoke test harness change creation',
      prediction: 'Creation should succeed',
      regressionRisk: ['Smoke regression risk'],
      expectedMetrics: { smoke: 'pass' },
      risk: 'low',
      runRef: 'run_smoke',
      traceRefs: ['event_smoke'],
    });
    if (!change.id.startsWith('hc_')) throw new Error('HarnessChange id prefix missing');
  });

  await check(components, 'detectLostness', async () => {
    const result = detectLostness({
      workingMemory: minimalWorkingMemory(),
      recentSignals: [],
      turnSnapshots: [],
    });
    if (result.triggered) throw new Error('Empty lostness input should not trigger');
  });

  await check(components, 'createContextAssemblyHook', async () => {
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, 'project-rules.md'), 'Smoke project rule', 'utf-8');
    const legacy = await createContextAssemblyHook({ memoryDir, useNewPipeline: false })();
    const next = await createContextAssemblyHook({ memoryDir, useNewPipeline: true })();
    if (!legacy.trim()) throw new Error('Legacy context assembly output empty');
    if (!next.trim()) throw new Error('New context assembly output empty');
  });

  return {
    passed: components.every((component) => component.status === 'ok'),
    components,
  };
}

async function check(
  components: SmokeTestResult['components'],
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
    components.push({ name, status: 'ok' });
  } catch (err) {
    components.push({
      name,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function minimalWorkingMemory(): TaskWorkingMemory {
  return {
    taskId: 'task_smoke',
    runId: 'run_smoke',
    goal: 'Smoke test working memory',
    phase: 'executing',
    currentStep: 'Verify component integration',
    todos: [],
    readFiles: [],
    writeFiles: [],
    recentErrors: [],
    recentSignals: [],
    artifactRefs: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function emptyRecallBundle(): RecallBundle {
  return {
    knacks: [],
    preferences: [],
    docFindings: [],
    historicalTaskSnapshots: [],
    artifactRefs: [],
    runArchiveRefs: [],
    diagnostics: {
      queryText: '',
      triggerUsed: {},
      totalCandidates: 0,
      dropped: [],
      penalties: [],
    },
  };
}
