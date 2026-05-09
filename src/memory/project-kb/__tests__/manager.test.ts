import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriteQueue } from '../../../core/write-queue.js';
import { ProjectKbManager } from '../manager.js';

describe('ProjectKbManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'project-kb-test-'));
    ProjectKbManager.resetInstance();
    WriteQueue.resetInstance();
  });

  afterEach(async () => {
    ProjectKbManager.resetInstance();
    WriteQueue.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('upserts cached docs and filters expired entries', async () => {
    const manager = ProjectKbManager.getInstance(tmpDir);
    await manager.upsert({
      sourceUrl: 'context7:/react#hooks',
      title: 'React hooks',
      content: 'hooks docs',
      now: new Date('2026-05-01T00:00:00.000Z'),
      ttlDays: 14,
    });

    expect(await manager.getFresh(5, new Date('2026-05-10T00:00:00.000Z'))).toHaveLength(1);
    expect(await manager.getFresh(5, new Date('2026-06-01T00:00:00.000Z'))).toHaveLength(0);
  });
});
