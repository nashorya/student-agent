import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PendingArchiveActionStore } from '../pending-actions.js';

describe('pending archive actions', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'archive-actions-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('does not stage the same action twice', async () => {
    const store = new PendingArchiveActionStore(root);
    const action = { key: 'task-1:create-adr:choice', taskId: 'task-1', type: 'create_adr' as const, payload: { title: 'Choice' } };
    await store.stage(action);
    await store.stage(action);
    expect(await store.list()).toHaveLength(1);
  });

  it('marks only named actions applied', async () => {
    const store = new PendingArchiveActionStore(root);
    await store.stage({ key: 'one', taskId: 'task-1', type: 'append_index', payload: { summary: 'One' } });
    await store.stage({ key: 'two', taskId: 'task-2', type: 'append_index', payload: { summary: 'Two' } });
    await store.markApplied(['one']);
    expect((await store.list('task-1'))[0].status).toBe('applied');
    expect((await store.list('task-2'))[0].status).toBe('pending');
  });
});
