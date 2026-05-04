import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriteQueue } from '../../core/write-queue.js';
import {
  BenchmarkResultsManager,
  BenchmarkRunner,
  SandboxBenchmarkExecutor,
  scoreTextSimilarity,
  type BenchmarkTask,
} from '../benchmark-runner.js';

describe('BenchmarkRunner', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'benchmark-runner-test-'));
    BenchmarkResultsManager.resetInstance();
    WriteQueue.resetInstance();
  });

  afterEach(async () => {
    BenchmarkResultsManager.resetInstance();
    WriteQueue.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('scoreTextSimilarity 用 token Jaccard 评分', () => {
    expect(scoreTextSimilarity('typed function signature', 'typed function signature')).toBe(1);
    expect(scoreTextSimilarity('totally different', 'typed function signature')).toBe(0);
  });

  it('runAll 执行基准任务并写入结果', async () => {
    const manager = BenchmarkResultsManager.getInstance(tmpDir);
    const tasks: BenchmarkTask[] = [
      {
        id: 'bench_1',
        description: 'test',
        referenceOutput: 'typed function signature',
      },
    ];
    const runner = new BenchmarkRunner(
      {
        run: async () => ({
          output: 'typed function signature',
          toolSignature: ['read', 'write'],
        }),
      },
      manager,
      tasks,
    );

    const results = await runner.runAll();

    expect(results[0].score).toBe(1);
    expect(await manager.getAll()).toHaveLength(1);
  });

  it('SandboxBenchmarkExecutor 复制 fixture 到临时目录并清理', async () => {
    const fixtureDir = join(tmpDir, 'fixture');
    await writeFile(join(tmpDir, 'fixture-file-placeholder'), '');
    await rm(fixtureDir, { recursive: true, force: true });
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(join(fixtureDir, 'input.txt'), 'fixture');
    let capturedSandboxDir = '';

    const executor = new SandboxBenchmarkExecutor({
      fixtureDir,
      tempRoot: tmpDir,
      executorFactory: (sandboxDir) => {
        capturedSandboxDir = sandboxDir;
        return {
          run: async () => {
            await access(join(sandboxDir, 'input.txt'));
            return {
              output: 'typed function signature',
              toolSignature: [],
            };
          },
        };
      },
    });

    await executor.run({
      id: 'bench_sandbox',
      description: 'sandbox',
      referenceOutput: 'typed function signature',
    });

    await expect(access(capturedSandboxDir)).rejects.toThrow();
  });
});
