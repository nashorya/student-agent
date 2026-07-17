import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TasksManager } from '../../memory/tasks/manager.js';
import { ArchiveService } from '../service.js';
import { ArchiveWorkflowCoordinator } from '../workflow.js';

describe('archive task workflow', () => {
  let root: string;
  let tasks: TasksManager;
  let service: ArchiveService;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'archive-workflow-'));
    await mkdir(join(root, 'docs/adr'), { recursive: true });
    await writeFile(join(root, 'docs/INDEX.md'), '# Index\n', 'utf8');
    await writeFile(join(root, 'docs/buglog.md'), '# Bugs\n', 'utf8');
    TasksManager.resetInstance(); tasks = TasksManager.getInstance(join(root, 'memory')); service = new ArchiveService({ root });
  });
  afterEach(async () => { TasksManager.resetInstance(); await rm(root, { recursive: true, force: true }); });

  it('keeps a verified ADR proposed until the user accepts it', async () => {
    const task = await tasks.createTask('Implement choice', ['work'], { workflowStatus: 'user_review', requiresUserAcceptance: true });
    await tasks.recordVerification(task.id, { kind: 'test', status: 'passed', summary: 'tests pass' });
    await service.stage({ key: 'choice', taskId: task.id, type: 'create_adr', payload: { id: 'ADR-001', title: 'Choice', summary: 'Use adapters', implementationStatus: 'verified' } });
    await new ArchiveWorkflowCoordinator(service, tasks).applyAfterVerification((await tasks.getActive())!);
    expect((await service.read()).adrs[0]).toMatchObject({ decisionStatus: 'proposed', implementationStatus: 'verified' });
    expect(await tasks.getActive()).toMatchObject({ pending_archive_acceptance: { adrId: 'ADR-001' } });
  });

  it('records accepted only after an accepted natural review response', async () => {
    const task = await tasks.createTask('Implement choice', ['work'], { workflowStatus: 'user_review', requiresUserAcceptance: true });
    await tasks.recordVerification(task.id, { kind: 'test', status: 'passed', summary: 'tests pass' });
    await service.stage({ key: 'choice', taskId: task.id, type: 'create_adr', payload: { id: 'ADR-001', title: 'Choice', summary: 'Use adapters', implementationStatus: 'verified' } });
    const coordinator = new ArchiveWorkflowCoordinator(service, tasks);
    await coordinator.applyAfterVerification((await tasks.getActive())!);
    await coordinator.handleUserReview((await tasks.getActive())!, '可以');
    expect((await service.read()).adrs[0].decisionStatus).toBe('accepted');
    expect((await tasks.getActive())?.pending_archive_acceptance).toBeUndefined();
  });
});
