import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArchiveText } from '../text-integrity.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('archive text integrity', () => {
  it('rejects binary Markdown before parsing', async () => {
    await expect(readArchiveText(join(fixtureDir, 'binary-markdown.bin')))
      .rejects.toThrow(/Archive source (contains NUL bytes|is not valid UTF-8)/);
  });

  it('returns strict UTF-8 text and a stable source hash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'archive-text-'));
    const path = join(dir, 'ADR-001.md');
    await writeFile(path, '# Decision\n\nUse Markdown.\n', 'utf8');

    try {
      await expect(readArchiveText(path)).resolves.toEqual({
        text: '# Decision\n\nUse Markdown.\n',
        sha256: 'b9ae66a9b80340f7afda67d74aa46e18188a565bfa33f3d92ecdd8a4228df354',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
