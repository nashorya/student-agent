import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReward } from '../reward.js';

describe('eval reward parser', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'eval-reward-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('reads reward.txt scores', async () => {
    await writeFile(join(tmpDir, 'reward.txt'), '0.75\n');
    await expect(readReward(tmpDir)).resolves.toEqual({ score: 0.75, source: 'reward.txt' });
  });

  it('prefers reward.json over reward.txt', async () => {
    await writeFile(join(tmpDir, 'reward.txt'), '0.25\n');
    await writeFile(join(tmpDir, 'reward.json'), JSON.stringify({ score: 1 }));
    await expect(readReward(tmpDir)).resolves.toEqual({ score: 1, source: 'reward.json' });
  });
});
