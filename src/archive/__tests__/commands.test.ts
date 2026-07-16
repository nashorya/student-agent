import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeArchiveCommand } from '../commands.js';
import { ArchiveService } from '../service.js';

describe('archive commands', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'archive-command-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('initializes and reports archive status', async () => {
    expect(await executeArchiveCommand(root, { type: 'archive', subcommand: 'init' })).toContain('initialized');
    expect(await executeArchiveCommand(root, { type: 'archive', subcommand: 'status' })).toContain('read_write');
  });

  it('stages explicit ADR and bug commands', async () => {
    await mkdir(join(root, 'docs/adr'), { recursive: true });
    await writeFile(join(root, 'docs/INDEX.md'), '# Index\n', 'utf8');
    await writeFile(join(root, 'docs/buglog.md'), '# Bugs\n', 'utf8');
    expect(await executeArchiveCommand(root, { type: 'archive', subcommand: 'adr-new', title: 'Adapter architecture' })).toContain('staged');
    expect(await executeArchiveCommand(root, { type: 'archive', subcommand: 'bug-open', title: 'Binary Markdown' })).toContain('staged');
    expect(await new ArchiveService({ root }).pending()).toHaveLength(2);
  });
});
