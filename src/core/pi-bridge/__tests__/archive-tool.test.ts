import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArchiveService } from '../../../archive/service.js';
import { createArchiveRecordToolDefinition } from '../archive-tool.js';

describe('archive_record tool', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'archive-tool-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('stages a proposed ADR without accepting it', async () => {
    const service = new ArchiveService({ root });
    const tool = createArchiveRecordToolDefinition(root, { service });
    await tool.execute('call-1', { action: 'create_adr', title: 'Adapter architecture', summary: 'Separate canonical data from HTML', taskId: 'task-1' });
    expect(await service.pending('task-1')).toContainEqual(expect.objectContaining({ type: 'create_adr', payload: expect.objectContaining({ decisionStatus: 'proposed' }) }));
  });

  it('does not expose an accept ADR action', () => {
    const tool = createArchiveRecordToolDefinition(root);
    expect(tool.promptGuidelines?.join('\n')).toContain('Never mark an ADR accepted');
    expect(JSON.stringify(tool.parameters)).not.toContain('accept_adr');
  });
});
