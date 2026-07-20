import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readFrozenInjectionSpec,
  resolveInjectionArm,
  runInjectionFamily,
} from '../../../scripts/eval-injection-experiment.js';

describe('injection experiment runner', () => {
  const roots: string[] = [];

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('reads sampling and family order from the frozen preregistration', async () => {
    const spec = await readFrozenInjectionSpec(resolve('docs/proposals/injection-effect-experiment-prereg-v0.md'));

    expect(spec.sampling).toEqual({
      model: 'glm-5.2',
      profile: 'zhipu-glm-5.2',
      thinking: 'enabled',
      temperature: 0,
      topP: 0.95,
      maxTokens: 16384,
    });
    expect(spec.families['F-DJ-MIGRATION-REFERENCE']).toEqual([
      'django__django-12125',
      'django__django-14580',
      'django__django-17087',
    ]);
  });

  it('routes all three arms without changing the learning pipeline', () => {
    expect(resolveInjectionArm('A')).toEqual({ variant: 'context_runtime', injectionMode: 'recall' });
    expect(resolveInjectionArm('B')).toEqual({ variant: 'plain', injectionMode: 'off' });
    expect(resolveInjectionArm('C')).toEqual({ variant: 'context_runtime', injectionMode: 'full' });
  });

  it('clears the arm-family memory root and runs the frozen order serially', async () => {
    const root = await mkdtemp(join(tmpdir(), 'injection-runner-'));
    roots.push(root);
    const memoryDir = join(root, 'memory', 'A', 'F-DJ-MIGRATION-REFERENCE');
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, 'stale.jsonl'), 'must disappear', 'utf8');
    const calls: Array<Record<string, unknown>> = [];
    const produce = vi.fn(async (options: Record<string, unknown>) => {
      calls.push(options);
      await expect(readFile(join(memoryDir, 'stale.jsonl'), 'utf8')).rejects.toThrow();
      const index = calls.length;
      const runId = `run_${index}`;
      await mkdir(join(memoryDir, 'runs', runId), { recursive: true });
      await writeFile(join(memoryDir, 'runs', runId, 'events.jsonl'), '{"kind":"tool_call"}\n', 'utf8');
      return {
        records: [{
          injectionSnapshot: `snapshot-${index}`,
          trace: { learningRun: { runId }, failureEscalationEvents: [] },
        }],
      };
    });

    const result = await runInjectionFamily({
      familyId: 'F-DJ-MIGRATION-REFERENCE',
      arm: 'A',
      instancesPath: join(root, 'instances.jsonl'),
      resultsDir: root,
      preregPath: resolve('docs/proposals/injection-effect-experiment-prereg-v0.md'),
    }, produce as never);

    expect(calls.map((call) => call.instanceIds)).toEqual([
      ['django__django-12125'],
      ['django__django-14580'],
      ['django__django-17087'],
    ]);
    expect(calls.every((call) => call.studentMemoryDir === memoryDir)).toBe(true);
    expect(calls.every((call) => call.studentLearningLifecycle === true)).toBe(true);
    expect(calls.every((call) => call.studentInjectionMode === 'recall')).toBe(true);
    expect(await readFile(join(result.runDirs[0], 'injection.txt'), 'utf8')).toBe('snapshot-1');
    expect(await readFile(join(result.runDirs[0], 'events.jsonl'), 'utf8')).toContain('tool_call');
  });

  it('fails closed when a required run artifact is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'injection-runner-'));
    roots.push(root);
    const produce = vi.fn(async () => ({
      records: [{ injectionSnapshot: undefined, trace: undefined }],
    }));

    await expect(runInjectionFamily({
      familyId: 'F-DJ-MIGRATION-REFERENCE',
      arm: 'B',
      instancesPath: join(root, 'instances.jsonl'),
      resultsDir: root,
      preregPath: resolve('docs/proposals/injection-effect-experiment-prereg-v0.md'),
    }, produce as never)).rejects.toThrow('Missing required audit artifacts');
  });
});
