import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseInjectionCliOptions,
  readInjectionSpec,
  resolveInjectionArm,
  runInjectionFamily,
  runInjectionFamilySeed,
} from '../../../scripts/eval-injection-experiment.js';
import { createInjectionBuildMemoryPrompt, seedContextRuntimeEvalMemory } from '../context-runtime-runner.js';
import { beginEvalLearningRun, finalizeEvalLearningRun } from '../eval-learning-lifecycle.js';
import { appendSignal } from '../../memory/signals/index.js';
import { RunArchiveWriter } from '../../memory/run-archive/index.js';
import { TasksManager } from '../../memory/tasks/manager.js';

const PREREG_V04 = 'docs/proposals/injection-effect-experiment-prereg-v0.4.md';
const FAMILY = 'F-DJ-MIGRATION-REFERENCE';

describe('injection experiment v0.4 runner', () => {
  const roots: string[] = [];

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('reads the three-arm sampling, snapshot, and three pinned families', async () => {
    const spec = await readInjectionSpec(resolve(PREREG_V04));
    expect(spec.version).toBe('v0.4');
    expect(spec.sampling).toEqual({
      model: 'glm-5.2', profile: 'zhipu-glm-5.2', thinking: 'enabled',
      temperature: 0, topP: 0.95, maxTokens: 16384,
    });
    expect(spec.dataset.commit).toBe('69611d31007e1c6731db8bd5b5c3f2d33f5bab6e');
    expect(Object.keys(spec.families).sort()).toEqual([
      'F-DJ-MIGRATION-REFERENCE', 'F-DJ-SELECT-MASK', 'F-SY-UNIT-EQUIVALENCE',
    ]);
    expect(spec.families['F-DJ-SELECT-MASK']).toEqual([
      'django__django-14667', 'django__django-15814', 'django__django-16910',
    ]);
  });

  it('defaults the CLI and audit directory to the v0.4 preregistration', () => {
    const options = parseInjectionCliOptions(
      ['--family', FAMILY, '--arm', 'B', '--seed-memory', '/tmp/seed', '--dry-run'],
      new Date('2026-07-28T00:00:00.000Z'),
    );
    expect(options.preregPath).toBe(resolve(PREREG_V04));
    expect(options.resultsDir).toBe(resolve(
      'evals/results/injection-experiment-v0.4/2026-07-28T00-00-00-000Z',
    ));
  });

  it('rejects the retired C arm at the CLI boundary', () => {
    expect(() => parseInjectionCliOptions(['--family', FAMILY, '--arm', 'C', '--dry-run']))
      .toThrow('--arm must be A-L, A-K, or B');
  });

  it('records the selected preregistration version instead of a runner constant', async () => {
    const root = await fixtureRoot();
    const preregPath = join(root, 'future-prereg.md');
    const source = await readFile(resolve(PREREG_V04), 'utf8');
    await writeFile(preregPath, source.replace('| 版本 | **v0.4**', '| 版本 | **v9.9**'));
    const result = await runInjectionFamily({
      ...runOptions(root, preregPath),
      dryRun: true,
    }, { produce: vi.fn(), score: vi.fn() });
    const manifest = JSON.parse(await readFile(join(result.batchDir, 'batch.json'), 'utf8'));
    expect(manifest.version).toBe('v9.9');
    expect(manifest.preregVersion).toBe('v9.9');
  });

  it('records the preregistration file digest in the batch manifest', async () => {
    const root = await fixtureRoot();
    const preregPath = resolve(PREREG_V04);
    const expected = createHash('sha256').update(await readFile(preregPath)).digest('hex');
    const result = await runInjectionFamily({
      ...runOptions(root, preregPath), dryRun: true,
    }, { produce: vi.fn(), score: vi.fn() });
    const manifest = JSON.parse(await readFile(join(result.batchDir, 'batch.json'), 'utf8'));
    expect(manifest.preregSha256).toBe(expected);
  });

  it('maps all three arms onto the same context runtime', () => {
    expect(resolveInjectionArm('A-L')).toEqual({ variant: 'context_runtime', injectionMode: 'lesson-recall' });
    expect(resolveInjectionArm('A-K')).toEqual({ variant: 'context_runtime', injectionMode: 'knack-recall' });
    expect(resolveInjectionArm('B')).toEqual({ variant: 'context_runtime', injectionMode: 'off' });
  });

  it('refuses a real run that does not name its harness and pinned snapshot', async () => {
    const root = await fixtureRoot();
    await seedFixture(root, { resolved: true });
    const { harnessPython: _p, snapshotManifest: _m, ...bare } = runOptions(root, resolve(PREREG_V04));
    await expect(runInjectionFamily(bare, {
      produce: vi.fn(), score: vi.fn(),
    })).rejects.toThrow('requires explicit harnessPython and snapshotManifest');
  });

  it('derives disjoint memory roots for every arm and family', async () => {
    const root = await fixtureRoot();
    const preregPath = resolve(PREREG_V04);
    const instancesPath = resolve('evals/inputs/injection-effect-frozen-instances.jsonl');
    const rootsSeen = new Set<string>();
    await Promise.all(
      (['A-L', 'A-K', 'B'] as const).flatMap((arm) =>
        ['F-DJ-MIGRATION-REFERENCE', 'F-SY-UNIT-EQUIVALENCE', 'F-DJ-SELECT-MASK'].map(async (familyId) => {
          const result = await runInjectionFamily({
            familyId, arm, instancesPath, resultsDir: root, preregPath, dryRun: true,
          }, { produce: vi.fn(), score: vi.fn() });
          rootsSeen.add(result.memoryDir);
          const manifest = JSON.parse(await readFile(join(result.batchDir, 'batch.json'), 'utf8'));
          expect(manifest.preregVersion).toBe('v0.4');
        }),
      ),
    );
    expect(rootsSeen.size).toBe(9);
  });

  it('runs the seed task once per family with injection off', async () => {
    const root = await fixtureRoot();
    const seedMemoryDir = join(root, 'memory', 'seed', FAMILY);
    const calls: Array<Record<string, unknown>> = [];
    const produce = vi.fn(async (options: Record<string, unknown>) => {
      calls.push(options);
      return fakeRecord(seedMemoryDir, 'seed_run', 'seed_task');
    });
    const score = vi.fn(async () => harnessResult(true));

    const result = await runInjectionFamilySeed({
      familyId: FAMILY, instancesPath: join(root, 'instances.jsonl'), resultsDir: root,
      preregPath: resolve(PREREG_V04),
      harnessPython: '/tmp/harness-python', snapshotManifest: '/tmp/snapshot.json',
    }, { produce: produce as never, score });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.instanceIds).toEqual(['django__django-12125']);
    expect(calls[0]!.studentInjectionMode).toBe('off');
    expect(calls[0]!.studentMemoryDir).toBe(seedMemoryDir);
    expect(calls[0]!.studentLearningTaskOffset).toBe(0);
    expect(result.resolved).toBe(true);
    expect(result.memoryDir).toBe(seedMemoryDir);
    const admission = JSON.parse(await readFile(join(result.runDir, 'admission.json'), 'utf8'));
    expect(admission.admission.resolved).toBe(true);
  });

  it('copies the seed memory and runs only tasks 2 and 3 in the arm phase', async () => {
    const root = await fixtureRoot();
    await seedFixture(root, { resolved: true });
    const memoryDir = join(root, 'memory', 'A-L', FAMILY);
    const calls: Array<Record<string, unknown>> = [];
    const produce = vi.fn(async (options: Record<string, unknown>) => {
      calls.push(options);
      return fakeRecord(memoryDir, `run_${calls.length}`, `task_${calls.length}`);
    });
    const score = vi.fn(async () => harnessResult(false));

    const result = await runInjectionFamily(runOptions(root, resolve(PREREG_V04)), {
      produce: produce as never, score,
    });

    expect(calls.map((call) => call.instanceIds)).toEqual([
      ['django__django-14580'], ['django__django-17087'],
    ]);
    expect(calls.map((call) => call.studentLearningTaskOffset)).toEqual([1, 2]);
    expect(calls.every((call) => call.studentMemoryDir === memoryDir)).toBe(true);
    expect(calls.every((call) => call.studentInjectionMode === 'lesson-recall')).toBe(true);
    expect(result.runDirs).toHaveLength(2);
    // The seed lesson survives the copy into the arm root.
    const before = JSON.parse(await readFile(join(result.runDirs[0]!, 'memory-inventory.json'), 'utf8')).before;
    expect(before.eligibleLessonIds).toEqual(['lesson_seed']);
  });

  it('starts every arm from an identical eligible memory set', async () => {
    const root = await fixtureRoot();
    await seedFixture(root, { resolved: true });
    const preregPath = resolve(PREREG_V04);
    const seen: Record<string, unknown> = {};
    for (const arm of ['A-L', 'A-K', 'B'] as const) {
      const memoryDir = join(root, 'memory', arm, FAMILY);
      let call = 0;
      const produce = vi.fn(async () => {
        call += 1;
        return fakeRecord(memoryDir, `${arm}_run_${call}`, `${arm}_task_${call}`);
      });
      const result = await runInjectionFamily({ ...runOptions(root, preregPath), arm }, {
        produce: produce as never, score: vi.fn(async () => harnessResult(false)),
      });
      const inventory = JSON.parse(await readFile(join(result.runDirs[0]!, 'memory-inventory.json'), 'utf8'));
      seen[arm] = inventory.before.eligibleLessonIds;
    }
    expect(seen['A-L']).toEqual(['lesson_seed']);
    expect(seen['A-K']).toEqual(seen['A-L']);
    expect(seen['B']).toEqual(seen['A-L']);
  });

  it('refuses the arm phase when the family seed is unresolved', async () => {
    const root = await fixtureRoot();
    await seedFixture(root, { resolved: false });
    const produce = vi.fn();
    await expect(runInjectionFamily(runOptions(root, resolve(PREREG_V04)), {
      produce: produce as never, score: vi.fn(),
    })).rejects.toThrow('seed run is unresolved');
    expect(produce).not.toHaveBeenCalled();
  });

  it('refuses the arm phase when no seed memory root exists', async () => {
    const root = await fixtureRoot();
    await expect(runInjectionFamily(runOptions(root, resolve(PREREG_V04)), {
      produce: vi.fn(), score: vi.fn(),
    })).rejects.toThrow('seed');
  });

  it('fails closed before scoring when a required agent artifact is missing', async () => {
    const root = await fixtureRoot();
    await seedFixture(root, { resolved: true });
    await expect(runInjectionFamily(runOptions(root, resolve(PREREG_V04)), {
      produce: vi.fn(async () => ({ records: [{ status: 'success' }] })) as never,
      score: vi.fn(),
    })).rejects.toThrow('Missing required audit artifacts');
  });

  it('replays seed online lesson birth into task2 lesson recall without a model', async () => {
    const root = await fixtureRoot();
    const seedMemoryDir = join(root, 'memory', 'seed', FAMILY);
    const armMemoryDir = join(root, 'memory', 'A-L', FAMILY);
    const preregPath = resolve(PREREG_V04);
    const snapshots: string[] = [];
    let call = 0;

    const produce = (memoryDir: string) => vi.fn(async (options: Record<string, unknown>) => {
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
      await beginEvalLearningRun(memoryDir);
      // Stand in for the agent phase: a tool error, a recovery edit, and a
      // passing check — the same material the online lesson writer consumes.
      const archive = new RunArchiveWriter({ memoryDir });
      await archive.appendEvent(runId, {
        timestamp: '2026-01-01T00:00:00.000Z',
        kind: 'tool_error',
        summary: 'ValueError: cannot serialize migration reference to a nested class',
        toolName: 'bash',
      });
      await archive.appendEvent(runId, {
        timestamp: '2026-01-01T00:00:40.000Z',
        kind: 'tool_call',
        summary: 'edit tool call',
        toolName: 'edit',
      });
      await appendSignal({
        id: `sig_${call}`,
        kind: 'tool_error',
        severity: 'medium',
        summary: 'ValueError: cannot serialize migration reference to a nested class',
        toolName: 'bash',
        toolCallId: `call_err_${call}`,
        createdAt: '2026-01-01T00:00:00.000Z',
      }, memoryDir);
      await finalizeEvalLearningRun({
        memoryDir,
        run: { taskId: active!.id, runId },
        taskDescription: 'Fix migration reference serializer.',
        gitDiff: '',
        status: 'success',
        finalSummary: 'Fix: use `__qualname__` for the migration reference serializer.',
        totalTaskCount: call,
        deferKnackPromotion: true,
        repo: 'django/django',
        toolCalls: [
          {
            id: `call_edit_${call}`,
            name: 'edit',
            args: {
              path: 'django/db/migrations/serializer.py',
              patch: 'use __qualname__ instead of __name__ for the nested migration reference serializer',
            },
            startedAt: '2026-01-01T00:00:30.000Z',
            endedAt: '2026-01-01T00:00:40.000Z',
            isError: false,
          },
          {
            id: `call_test_${call}`,
            name: 'bash',
            args: { command: 'pytest tests/migrations' },
            startedAt: '2026-01-01T00:01:00.000Z',
            endedAt: '2026-01-01T00:01:10.000Z',
            isError: false,
          },
        ],
      });
      return { records: [{ status: 'success', injectionSnapshot: prompt,
        trace: { learningRun: { runId, taskId: active!.id }, failureEscalationEvents: [] } }] };
    });

    await runInjectionFamilySeed({
      familyId: FAMILY, instancesPath: join(root, 'instances.jsonl'), resultsDir: root, preregPath,
      harnessPython: '/tmp/harness-python', snapshotManifest: '/tmp/snapshot.json',
    }, { produce: produce(seedMemoryDir) as never, score: vi.fn(async () => harnessResult(true)) });

    await runInjectionFamily(runOptions(root, preregPath), {
      produce: produce(armMemoryDir) as never,
      score: vi.fn(async () => harnessResult(false)),
    });

    expect(snapshots[0]).not.toContain('[recall:lesson_');
    expect(snapshots[1]).toContain('[recall:lesson_');
    expect(snapshots[1]).toContain('Do not apply when: The triggering context is absent');
    expect(snapshots[1]).not.toContain('__qualname__');
    expect(snapshots[1]).not.toContain('ValueError');
  });

  it('persists failed-run artifacts and never calls the harness', async () => {
    const root = await fixtureRoot();
    await seedFixture(root, { resolved: true });
    const memoryDir = join(root, 'memory', 'A-L', FAMILY);
    const produce = vi.fn(async () => {
      await mkdir(join(memoryDir, 'runs', 'failed_run'), { recursive: true });
      await writeFile(join(memoryDir, 'runs', 'failed_run', 'events.jsonl'), '{"kind":"tool_error"}\n');
      return { records: [{ status: 'failed', errorMessage: 'rate limited', injectionSnapshot: 'empty',
        trace: { learningRun: { runId: 'failed_run', taskId: 'failed_task' }, failureEscalationEvents: [] } }] };
    });
    const score = vi.fn();
    await expect(runInjectionFamily(runOptions(root, resolve(PREREG_V04)), {
      produce: produce as never, score,
    })).rejects.toThrow('rate limited');
    expect(score).not.toHaveBeenCalled();
    expect(await readFile(join(root, 'A-L', FAMILY,
      '2-django__django-14580', 'events.jsonl'), 'utf8')).toContain('tool_error');
  });

  it('counts a clean agent empty patch as unresolved and continues without scoring it', async () => {
    const root = await fixtureRoot();
    await seedFixture(root, { resolved: true });
    const memoryDir = join(root, 'memory', 'A-L', FAMILY);
    let call = 0;
    const produce = vi.fn(async () => {
      call += 1;
      const runId = `empty_or_run_${call}`;
      await mkdir(join(memoryDir, 'runs', runId), { recursive: true });
      await writeFile(join(memoryDir, 'runs', runId, 'events.jsonl'), '{"kind":"tool_call"}\n');
      return { records: [{
        status: call === 1 ? 'failed' : 'success',
        emptyPatch: call === 1,
        ...(call === 1 ? { errorMessage: 'Agent produced an empty patch' } : {}),
        injectionSnapshot: '',
        trace: { status: 'success', learningRun: { runId, taskId: `task_${call}` }, failureEscalationEvents: [] },
      }] };
    });
    const score = vi.fn(async () => harnessResult(false));

    const result = await runInjectionFamily(runOptions(root, resolve(PREREG_V04)), {
      produce: produce as never, score,
    });

    expect(produce).toHaveBeenCalledTimes(2);
    expect(score).toHaveBeenCalledTimes(1);
    const first = JSON.parse(await readFile(join(result.runDirs[0]!, 'admission.json'), 'utf8'));
    expect(first.admission.resolved).toBe(false);
    expect(first.harness).toBeNull();
    expect(first.harnessSkipped.reason).toBe('empty_patch_counted_unresolved');
  });

  async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'injection-v04-runner-'));
    roots.push(root);
    await writeFile(join(root, 'instances.jsonl'), [12125, 14580, 17087].map((id) => JSON.stringify({
      instance_id: `django__django-${id}`, repo: 'django/django', base_commit: `base-${id}`,
      problem_statement: `Issue ${id}`,
    })).join('\n') + '\n');
    return root;
  }

  /** Stand in for a completed seed phase without running the birth pipeline. */
  async function seedFixture(root: string, options: { resolved: boolean }): Promise<string> {
    const seedMemoryDir = join(root, 'memory', 'seed', FAMILY);
    await mkdir(seedMemoryDir, { recursive: true });
    await writeFile(join(seedMemoryDir, 'injection-admission.json'), JSON.stringify({
      version: 1,
      entries: [{
        runId: 'seed_run', taskId: 'seed_task', instanceId: 'django__django-12125',
        resolved: options.resolved, recordedAt: '2026-07-28T00:00:00.000Z',
      }],
    }));
    if (options.resolved) {
      await writeFile(join(seedMemoryDir, 'lessons.jsonl'), JSON.stringify({
        id: 'lesson_seed',
        sourceSignalId: 'sig_seed',
        lesson: 'Symptom: nested class path serialized by short name. Fix: use __qualname__.',
        trigger: { signalKinds: ['tool_error'], paths: ['django/db/migrations/serializer.py'] },
        applicableWhen: ['serializing a migration reference'],
        doNotApplyWhen: [],
        evidenceRefs: [],
        severity: 'medium',
        quality: 'high',
        confidence: 'verified',
        promotedAt: '2026-07-28T00:00:00.000Z',
        repo: 'django/django',
        symptom: 'migration reference points at the wrong object',
        fixSummary: 'use __qualname__ instead of __name__',
        status: 'observed',
        provenance: { taskId: 'seed_task', sessionRef: 'seed_run', signalId: 'sig_seed' },
      }) + '\n');
    }
    return seedMemoryDir;
  }

  async function fakeRecord(memoryDir: string, runId: string, taskId: string) {
    await mkdir(join(memoryDir, 'runs', runId), { recursive: true });
    await writeFile(join(memoryDir, 'runs', runId, 'events.jsonl'), '{"kind":"tool_call"}\n');
    return { records: [{ status: 'success', injectionSnapshot: `snapshot-${runId}`,
      trace: { learningRun: { runId, taskId }, failureEscalationEvents: [] } }] };
  }

  function harnessResult(resolved: boolean) {
    return {
      resolved, summaryPath: 'summary', instanceReportPath: 'report',
      summary: resolved ? { resolved_ids: ['x'] } : { resolved_ids: [], unresolved_ids: ['x'] },
    };
  }

  function runOptions(root: string, preregPath: string) {
    return {
      familyId: FAMILY,
      arm: 'A-L' as const,
      instancesPath: join(root, 'instances.jsonl'), resultsDir: root, preregPath,
      seedMemoryDir: join(root, 'memory', 'seed', FAMILY),
      harnessPython: '/tmp/harness-python', snapshotManifest: '/tmp/snapshot.json',
    };
  }
});
