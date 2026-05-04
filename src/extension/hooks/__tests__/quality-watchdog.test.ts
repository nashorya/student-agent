import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriteQueue } from '../../../core/write-queue.js';
import { PreferenceCandidatesManager } from '../../../memory/candidates/manager.js';
import { QualityFeedbackManager } from '../../../watchdog/feedback-collector.js';
import { BenchmarkResultsManager } from '../../../watchdog/benchmark-runner.js';
import { createQualityWatchdogHook, _resetForTesting } from '../quality-watchdog.js';

describe('quality watchdog hook', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'quality-watchdog-hook-test-'));
    WriteQueue.resetInstance();
    PreferenceCandidatesManager.resetInstance();
    QualityFeedbackManager.resetInstance();
    BenchmarkResultsManager.resetInstance();
    _resetForTesting();
  });

  afterEach(async () => {
    WriteQueue.resetInstance();
    PreferenceCandidatesManager.resetInstance();
    QualityFeedbackManager.resetInstance();
    BenchmarkResultsManager.resetInstance();
    _resetForTesting();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('每 5 次 session end 输出反馈提示', async () => {
    const hook = createQualityWatchdogHook(tmpDir);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    for (let i = 0; i < 5; i++) {
      await hook({ messages: [] });
    }

    expect(logSpy).toHaveBeenCalledWith(
      '[QualityWatchdog] 可用 /feedback up|down <说明> 记录本轮质量反馈。',
    );
    logSpy.mockRestore();
  });
});
