import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultArchiveConfig, discoverArchive } from '../discovery.js';

describe('archive discovery', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'archive-discovery-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('prefers explicit project archive paths', async () => {
    const result = await discoverArchive(root, {
      ...defaultArchiveConfig(), indexPath: 'project/HISTORY.md', adrDir: 'project/decisions',
    });
    expect(result.paths.indexPath).toBe('project/HISTORY.md');
    expect(result.paths.adrDir).toBe('project/decisions');
  });

  it('reports conflicting ADR directories instead of choosing silently', async () => {
    await mkdir(join(root, 'docs/adr'), { recursive: true });
    await mkdir(join(root, 'docs/decisions'), { recursive: true });
    const result = await discoverArchive(root, defaultArchiveConfig());
    expect(result.writeMode).toBe('blocked');
    expect(result.conflicts).toContain('multiple_adr_directories');
  });

  it('requires initialization when no archive exists', async () => {
    const result = await discoverArchive(root, defaultArchiveConfig());
    expect(result.initializationRequired).toBe(true);
    expect(result.writeMode).toBe('read_only');
  });
});
