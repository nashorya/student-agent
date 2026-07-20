import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readFrozenInjectionSpec,
  resolveInjectionArm,
  runInjectionFamily,
} from '../../../scripts/eval-injection-experiment.js';
import { createInjectionBuildMemoryPrompt, seedContextRuntimeEvalMemory } from '../context-runtime-runner.js';
import { TasksManager } from '../../memory/tasks/manager.js';

describe('injection experiment v0.2 runner', () => {
  const roots: string[] = [];

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('reads the frozen four-arm sampling, snapshot, and family order', async () => {
    const spec = await readFrozenInjectionSpec(resolve('docs/proposals/injection-effect-experiment-prereg-v0.2.md'));
    expect(spec.frozen).toBe(true);
    expect(spec.sampling).toEqual({
      model: 'glm-5.2', profile: 'zhipu-glm-5.2', thinking: 'enabled',
      temperature: 0, topP: 0.95, maxTokens: 16384,
    });
    expect(spec.dataset.commit).toBe('69611d31007e1c6731db8bd5b5c3f2d33f5bab6e');
    expect(spec.families['F-DJ-MIGRATION-REFERENCE']).toEqual([
      'django__django-12125', 'django__django-14580', 'django__django-17087',
    ]);
  });

  it('maps all four arms onto the same context runtime', () => {
    expect(resolveInjectionArm('A-L')).toEqual({ variant: 'context_runtime', injectionMode: 'lesson-recall' });
    expect(resolveInjectionArm('A-K')).toEqual({ variant: 'context_runtime', injectionMode: 'knack-recall' });
    expect(resolveInjectionArm('B')).toEqual({ variant: 'context_runtime', injectionMode: 'off' });
    expect(resolveInjectionArm('C')).toEqual({ variant: 'context_runtime', injectionMode: 'lesson-full' });
  });

  it('refuses model execution while v0.2 is not frozen', async () => {
    const root = await fixtureRoot();
    await expect(runInjectionFamily(runOptions(root, await draftPrereg(root)), {
      produce: vi.fn(), score: vi.fn(),
    })).rejects.toThrow('not frozen');
  });

  it('derives disjoint memory roots for every arm and family', async () => {
    const root = await fixtureRoot();
    const preregPath = resolve('docs/proposals/injection-effect-experiment-prereg-v0.2.md');
    const instancesPath = resolve('evals/inputs/injection-effect-frozen-instances.jsonl');
    const rootsSeen = new Set<string>();
    for (const arm of ['A-L', 'A-K', 'B', 'C'] as const) {
      for (const familyId of ['F-DJ-MIGRATION-REFERENCE', 'F-SY-UNIT-EQUIVALENCE']) {
        const result = await runInjectionFamily({
          familyId, arm, instancesPath, resultsDir: root, preregPath, dryRun: true,
        }, { produce: vi.fn(), score: vi.fn() });
        rootsSeen.add(result.memoryDir);
      }
    }
    expect(rootsSeen.size).toBe(8);
  });

  it('clears one arm-family root, runs three fresh tasks serially, and continues after unresolved', async () => {
    const root = await fixtureRoot();
    const preregPath = await frozenPrereg(root);
    const memoryDir = join(root, 'memory', 'A-L', 'F-DJ-MIGRATION-REFERENCE');
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, 'stale.jsonl'), 'must disappear');
    const calls: Array<Record<string, unknown>> = [];
    const produce = vi.fn(async (options: Record<string, unknown>) => {
      calls.push(options);
      await expect(readFile(join(memoryDir, 'stale.jsonl',), 'utf8')).rejects.toThrow();
      const index = calls.length;
      const runId = `run_${index}`;
      const taskId = `task_${index}`;
      await mkdir(join(memoryDir, 'runs', runId), { recursive: true });
      await writeFile(join(memoryDir, 'runs', runId, 'events.jsonl'), '{"kind":"tool_call"}\n');
      return { records: [{ status: 'success', injectionSnapshot: `snapshot-${index}`,
        trace: { learningRun: { runId, taskId }, failureEscalationEvents: [] } }] };
    });
    const score = vi.fn(async () => ({ resolved: false, summaryPath: 'summary', instanceReportPath: 'report',
      summary: { resolved_ids: [], unresolved_ids: ['x'] } }));

    const result = await runInjectionFamily(runOptions(root, preregPath), { produce: produce as never, score });

    expect(calls.map((call) => call.instanceIds)).toEqual([
      ['django__django-12125'], ['django__django-14580'], ['django__django-17087'],
    ]);
    expect(calls.every((call) => call.studentMemoryDir === memoryDir)).toBe(true);
    expect(calls.every((call) => call.studentInjectionMode === 'lesson-recall')).toBe(true);
    expect(calls.every((call) => call.studentDeferKnackPromotion === true)).toBe(true);
    expect(score).toHaveBeenCalledTimes(3);
    expect(JSON.parse(await readFile(join(result.runDirs[0]!, 'admission.json'), 'utf8')).admission.resolved).toBe(false);
  });

  it('fails closed before scoring when a required agent artifact is missing', async () => {
    const root = await fixtureRoot();
    await expect(runInjectionFamily(runOptions(root, await frozenPrereg(root)), {
      produce: vi.fn(async () => ({ records: [{ status: 'success' }] })) as never,
      score: vi.fn(),
    })).rejects.toThrow('Missing required audit artifacts');
  });

  it('replays task1 resolved distillation into task2 lesson recall without a model', async () => {
    const root = await fixtureRoot();
    const memoryDir = join(root, 'memory', 'A-L', 'F-DJ-MIGRATION-REFERENCE');
    const snapshots: string[] = [];
    let call = 0;
    const produce = vi.fn(async (options: Record<string, unknown>) => {
      call += 1;
      const instanceId = (options.instanceIds as string[])[0]!;
      const task = {
        id: instanceId, title: 'migration reference serializer', mode: 'direct' as const,
        workspace: root, instructionPath: join(root, `${instanceId}.md`),
        fixture: { workspace: root, files: {}, seed: [], verification: { commands: [] } },
        rubric: { required: [], forbidden: [], testScriptPath: '' },
      };
      await seedContextRuntimeEvalMemory({ memoryDir, task, instruction: 'Fix migration reference serializer.' });
      const active = await TasksManager.getInstance(memoryDir).getActive();
      const runId = active!.working_memory.runId;
      const prompt = await (await createInjectionBuildMemoryPrompt('lesson-recall', memoryDir))();
      snapshots.push(prompt);
      await mkdir(join(memoryDir, 'runs', runId), { recursive: true });
      await writeFile(join(memoryDir, 'runs', runId, 'events.jsonl'), [
        JSON.stringify({ kind: 'tool_error', summary: 'migration reference serializer failed' }),
        JSON.stringify({ kind: 'tool_call', toolName: 'edit' }),
        '',
      ].join('\n'));
      await writeFile(join(memoryDir, 'runs', runId, 'outcome.json'), JSON.stringify({
        taskId: active!.id, finalSummary: 'Fix: use `__qualname__` for the migration reference serializer.',
      }));
      return { records: [{ status: 'success', injectionSnapshot: prompt,
        trace: { learningRun: { runId, taskId: active!.id }, failureEscalationEvents: [] } }] };
    });
    const score = vi.fn(async () => ({ resolved: call === 1, summaryPath: 'summary', instanceReportPath: 'report',
      summary: call === 1 ? { resolved_ids: ['first'] } : { unresolved_ids: ['later'] } }));

    await runInjectionFamily(runOptions(root, await frozenPrereg(root)), { produce: produce as never, score });

    expect(snapshots[0]).not.toContain('[recall:lesson_');
    expect(snapshots[1]).toContain('[recall:lesson_');
    expect(snapshots[1]).toContain('__qualname__');
  });

  it('persists failed-run artifacts and never calls the harness', async () => {
    const root = await fixtureRoot();
    const memoryDir = join(root, 'memory', 'A-L', 'F-DJ-MIGRATION-REFERENCE');
    const produce = vi.fn(async () => {
      await mkdir(join(memoryDir, 'runs', 'failed_run'), { recursive: true });
      await writeFile(join(memoryDir, 'runs', 'failed_run', 'events.jsonl'), '{"kind":"tool_error"}\n');
      return { records: [{ status: 'failed', errorMessage: 'rate limited', injectionSnapshot: 'empty',
        trace: { learningRun: { runId: 'failed_run', taskId: 'failed_task' }, failureEscalationEvents: [] } }] };
    });
    const score = vi.fn();
    await expect(runInjectionFamily(runOptions(root, await frozenPrereg(root)), {
      produce: produce as never, score,
    })).rejects.toThrow('rate limited');
    expect(score).not.toHaveBeenCalled();
    expect(await readFile(join(root, 'A-L', 'F-DJ-MIGRATION-REFERENCE',
      '1-django__django-12125', 'events.jsonl'), 'utf8')).toContain('tool_error');
  });

  async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'injection-v02-runner-'));
    roots.push(root);
    await writeFile(join(root, 'instances.jsonl'), [12125, 14580, 17087].map((id) => JSON.stringify({
      instance_id: `django__django-${id}`, repo: 'django/django', base_commit: `base-${id}`,
      problem_statement: `Issue ${id}`,
    })).join('\n') + '\n');
    return root;
  }

  async function frozenPrereg(root: string): Promise<string> {
    const target = join(root, 'prereg.md');
    const source = await readFile(resolve('docs/proposals/injection-effect-experiment-prereg-v0.2.md'), 'utf8');
    await writeFile(target, source.replace(/^状态：.*$/mu, '状态：**已冻结（test fixture）**'));
    return target;
  }

  async function draftPrereg(root: string): Promise<string> {
    const target = join(root, 'draft-prereg.md');
    const source = await readFile(resolve('docs/proposals/injection-effect-experiment-prereg-v0.2.md'), 'utf8');
    await writeFile(target, source.replace(/^状态：.*$/mu, '状态：**待作者批准冻结（test fixture）**'));
    return target;
  }

  function runOptions(root: string, preregPath: string) {
    return {
      familyId: 'F-DJ-MIGRATION-REFERENCE' as const,
      arm: 'A-L' as const,
      instancesPath: join(root, 'instances.jsonl'), resultsDir: root, preregPath,
      harnessPython: '/tmp/harness-python', snapshotManifest: '/tmp/snapshot.json',
    };
  }
});
