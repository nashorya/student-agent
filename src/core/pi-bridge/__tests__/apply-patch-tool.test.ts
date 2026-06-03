import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplyPatchToolDefinition } from '../apply-patch-tool.js';

describe('apply_patch tool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'student-apply-patch-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('applies update hunks without edit oldText arguments', async () => {
    await writeFile(join(tmpDir, 'app.ts'), [
      'const name = "old";',
      'console.log(name);',
      '',
    ].join('\n'));
    const tool = createApplyPatchToolDefinition(tmpDir);

    await tool.execute('tool_1', {
      input: [
        '*** Begin Patch',
        '*** Update File: app.ts',
        '@@',
        '-const name = "old";',
        '+const name = "new";',
        ' console.log(name);',
        '*** End Patch',
      ].join('\n'),
    }, undefined, undefined, undefined as never);

    await expect(readFile(join(tmpDir, 'app.ts'), 'utf8'))
      .resolves.toBe('const name = "new";\nconsole.log(name);\n');
  });

  it('adds files and accepts patch as a compatibility alias', async () => {
    const tool = createApplyPatchToolDefinition(tmpDir);
    const params = tool.prepareArguments?.({
      patch: [
        '*** Begin Patch',
        '*** Add File: src/created.ts',
        '+export const created = true;',
        '*** End Patch',
      ].join('\n'),
    }) ?? { input: '' };

    await tool.execute('tool_1', params, undefined, undefined, undefined as never);

    await expect(readFile(join(tmpDir, 'src/created.ts'), 'utf8'))
      .resolves.toBe('export const created = true;\n');
  });

  it('rejects paths outside the project root', async () => {
    const tool = createApplyPatchToolDefinition(tmpDir);

    await expect(tool.execute('tool_1', {
      input: [
        '*** Begin Patch',
        '*** Add File: ../escape.ts',
        '+nope',
        '*** End Patch',
      ].join('\n'),
    }, undefined, undefined, undefined as never)).rejects.toThrow('Path escapes project root');
  });
});
