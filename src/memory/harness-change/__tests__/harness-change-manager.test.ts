import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WriteQueue } from '../../../core/write-queue.js';
import { HarnessChangeManager } from '../harness-change-manager.js';
import type { CreateHarnessChangeInput, HarnessChange } from '../types.js';

describe('HarnessChangeManager', () => {
  let memoryDir: string;
  let manager: HarnessChangeManager;

  beforeEach(async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'harness-change-test-'));
    WriteQueue.resetInstance();
    manager = new HarnessChangeManager({ memoryDir });
  });

  afterEach(async () => {
    WriteQueue.resetInstance();
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('creates a proposed harness change with required regression risks', async () => {
    const change = await manager.create(input());

    expect(change).toMatchObject({
      targetComponent: 'ContextBuilder',
      rationale: 'Reduce prompt bloat',
      prediction: 'Lower lostness without reducing task accuracy',
      regressionRisk: ['May omit useful recalled items'],
      expectedMetrics: { lostnessRate: 'down' },
      risk: 'medium',
      runRef: 'run_1',
      traceRefs: ['event_1'],
      evalBefore: { passRate: 0.7 },
      status: 'proposed',
    });
    expect(change.id).toMatch(/^hc_/);
    expect(change.createdAt).toEqual(expect.any(String));

    const all = await manager.getAll();
    expect(all).toEqual([change]);
    expect(await manager.getById(change.id)).toEqual(change);
  });

  it('throws when regressionRisk is empty', async () => {
    await expect(manager.create({
      ...input(),
      regressionRisk: [],
    })).rejects.toThrow('regressionRisk must contain at least one risk');
    expect(await manager.getAll()).toEqual([]);
  });

  it('moves through proposed to applied to verified and persists evalAfter', async () => {
    const change = await manager.create(input());

    await manager.markApplied(change.id);
    expect(await manager.getById(change.id)).toMatchObject({
      id: change.id,
      status: 'applied',
    });

    await manager.verify(change.id, { passRate: 0.9, regressionCount: 0 });
    const verified = await manager.getById(change.id);
    expect(verified).toMatchObject({
      id: change.id,
      status: 'verified',
      evalAfter: { passRate: 0.9, regressionCount: 0 },
      verifiedAt: expect.any(String),
    });

    const persisted = (await readHarnessChanges(memoryDir))[0];
    expect(persisted).toEqual(verified);
  });

  it('marks a harness change as reverted', async () => {
    const change = await manager.create(input());

    await manager.revert(change.id);

    expect(await manager.getById(change.id)).toMatchObject({
      id: change.id,
      status: 'reverted',
    });
  });
});

function input(overrides: Partial<CreateHarnessChangeInput> = {}): CreateHarnessChangeInput {
  return {
    targetComponent: 'ContextBuilder',
    rationale: 'Reduce prompt bloat',
    prediction: 'Lower lostness without reducing task accuracy',
    regressionRisk: ['May omit useful recalled items'],
    expectedMetrics: { lostnessRate: 'down' },
    risk: 'medium',
    runRef: 'run_1',
    traceRefs: ['event_1'],
    evalBefore: { passRate: 0.7 },
    ...overrides,
  };
}

async function readHarnessChanges(memoryDir: string): Promise<HarnessChange[]> {
  const raw = await readFile(join(memoryDir, 'harness-changes.jsonl'), 'utf-8');
  return raw.trim().split('\n').map((line) => JSON.parse(line) as HarnessChange);
}
