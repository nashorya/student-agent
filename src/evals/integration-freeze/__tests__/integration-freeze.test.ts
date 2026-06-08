import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WriteQueue } from '../../../core/write-queue.js';
import { PreferenceCandidatesManager } from '../../../memory/candidates/manager.js';
import { PlanRevisionManager } from '../../../memory/plan-revisions/manager.js';
import { PreferencesManager } from '../../../memory/preferences/manager.js';
import { ProjectKbManager } from '../../../memory/project-kb/manager.js';
import { QuestionsManager } from '../../../memory/questions/manager.js';
import { TasksManager } from '../../../memory/tasks/manager.js';
import { captureCurrentSchemas, checkFreeze } from '../schema-snapshot.js';
import { runSmokeTest } from '../smoke-test-runner.js';
import type { SchemaSnapshot } from '../types.js';

describe('integration freeze', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'integration-freeze-test-'));
    resetManagers();
  });

  afterEach(async () => {
    resetManagers();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('captures non-empty schema field names', () => {
    const snapshot = captureCurrentSchemas();

    expect(snapshot.version).toBeTruthy();
    expect(snapshot.capturedAt).toBeTruthy();
    for (const fields of Object.values(snapshot.schemas)) {
      expect(fields.length).toBeGreaterThan(0);
    }
  });

  it('passes freeze check when snapshots are identical', () => {
    const snapshot = captureCurrentSchemas();

    expect(checkFreeze(snapshot, snapshot)).toEqual({
      passed: true,
      breakingChanges: [],
    });
  });

  it('detects removed fields as breaking changes', () => {
    const baseline = captureCurrentSchemas();
    const current: SchemaSnapshot = {
      ...baseline,
      schemas: {
        ...baseline.schemas,
        runEvent: baseline.schemas.runEvent.filter((field) => field !== 'metadata'),
      },
    };

    const result = checkFreeze(baseline, current);

    expect(result.passed).toBe(false);
    expect(result.breakingChanges).toEqual([{
      schema: 'runEvent',
      missing: ['metadata'],
      added: [],
    }]);
  });

  it('runs all integration smoke checks successfully', async () => {
    const result = await runSmokeTest(tmpDir);

    expect(result.passed).toBe(true);
    expect(result.components.map((component) => component.name)).toEqual([
      'JsonlMemoryStore.search',
      'RecallRouter.recall',
      'ContextBuilder.build',
      'RunArchiveWriter',
      'HarnessChangeManager.create',
      'detectLostness',
      'createContextAssemblyHook',
    ]);
    expect(result.components.every((component) => component.status === 'ok')).toBe(true);
  });
});

function resetManagers(): void {
  PreferenceCandidatesManager.resetInstance();
  PlanRevisionManager.resetInstance();
  PreferencesManager.resetInstance();
  ProjectKbManager.resetInstance();
  QuestionsManager.resetInstance();
  TasksManager.resetInstance();
  WriteQueue.resetInstance();
}
