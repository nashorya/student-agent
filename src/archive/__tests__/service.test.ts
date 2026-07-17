import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArchiveService } from '../service.js';

describe('ArchiveService', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'archive-service-'));
    await mkdir(join(root, 'docs/adr'), { recursive: true });
    await writeFile(join(root, 'docs/INDEX.md'), '| 日期 | 事件 |\n|---|---|\n', 'utf8');
    await writeFile(join(root, 'docs/buglog.md'), '# Buglog\n', 'utf8');
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('builds a health dashboard from an arbitrary project root', async () => {
    await writeFile(join(root, 'docs/adr/ADR-001-choice.md'), '---\nid: ADR-001\ntitle: Choice\ndate: 2026-07-14\ndecision_status: proposed\nimplementation_status: verified\n---\nBody\n', 'utf8');
    const result = await new ArchiveService({ root, config: { dashboardPath: 'docs/dashboard.html' } }).build();
    expect(result.dashboardPath).toBe('docs/dashboard.html');
    expect(await readFile(join(root, 'docs/dashboard.html'), 'utf8')).toContain('ADR waiting for acceptance');
  });

  it('preserves canonical files when candidate validation fails', async () => {
    const indexPath = join(root, 'docs/INDEX.md');
    const before = await readFile(indexPath, 'utf8');
    const service = new ArchiveService({ root });
    await expect(service.apply([{ key: 'bad', taskId: 'task-1', type: 'create_adr', payload: { id: 'ADR-001', title: 'Invalid', decisionStatus: 'accepted' } }]))
      .rejects.toThrow('accepted_adr_without_user_evidence');
    expect(await readFile(indexPath, 'utf8')).toBe(before);
  });
});
