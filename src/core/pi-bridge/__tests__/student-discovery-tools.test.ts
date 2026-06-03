import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createStudentGlobToolDefinition,
  createStudentListFilesToolDefinition,
  createStudentReadManyToolDefinition,
  createStudentSearchFilesToolDefinition,
  type RipgrepRunner,
} from '../student-discovery-tools.js';

describe('student discovery tools', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'student-discovery-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects paths outside the project root', async () => {
    const tool = createStudentListFilesToolDefinition(tmpDir);

    await expect(tool.execute('tool_1', { path: '..' }, undefined, undefined, undefined as never))
      .rejects.toThrow('Path escapes project root');
  });

  it('list_files skips ignored directories, caps output, and distinguishes entry types', async () => {
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await mkdir(join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'app.ts'), 'export const app = true;\n');
    await writeFile(join(tmpDir, 'src', 'extra.ts'), 'export const extra = true;\n');
    await writeFile(join(tmpDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};\n');
    const tool = createStudentListFilesToolDefinition(tmpDir);

    const result = await tool.execute('tool_1', { recursive: true, maxEntries: 2 }, undefined, undefined, undefined as never);
    const text = getText(result);

    expect(text).toContain('directory src/');
    expect(text).toContain('file src/app.ts');
    expect(text).not.toContain('node_modules');
    expect(text).toContain('2 entries limit reached');
    expect(result.details).toMatchObject({ count: 2, truncated: true });
  });

  it('glob matches files by path without reading file contents', async () => {
    await mkdir(join(tmpDir, 'src', 'features'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'features', 'target.ts'), 'SECRET_CONTENT_SHOULD_NOT_APPEAR\n');
    await writeFile(join(tmpDir, 'src', 'features', 'target.test.ts'), 'test\n');
    await writeFile(join(tmpDir, 'src', 'features', 'notes.md'), 'notes\n');
    const tool = createStudentGlobToolDefinition(tmpDir);

    const result = await tool.execute('tool_1', { pattern: '**/*.ts', path: 'src' }, undefined, undefined, undefined as never);
    const text = getText(result);

    expect(text).toContain('src/features/target.ts');
    expect(text).toContain('src/features/target.test.ts');
    expect(text).not.toContain('notes.md');
    expect(text).not.toContain('SECRET_CONTENT_SHOULD_NOT_APPEAR');
  });

  it('search_files uses an rg-style argument array and truncates output', async () => {
    let observedArgs: string[] | undefined;
    const targetPath = join(tmpDir, 'src', 'target.ts');
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(targetPath, 'export const computeMode = "experimental";\n');
    const target = await realpath(targetPath);
    const runRipgrep: RipgrepRunner = async (args) => {
      observedArgs = args;
      return {
        stdout: `${JSON.stringify({
          type: 'match',
          data: {
            path: { text: target },
            line_number: 1,
            lines: { text: 'export const computeMode = "experimental";\n' },
          },
        })}\n`,
        stderr: '',
        exitCode: 0,
      };
    };
    const tool = createStudentSearchFilesToolDefinition(tmpDir, { runRipgrep });

    const result = await tool.execute('tool_1', { query: 'computeMode', maxChars: 45 }, undefined, undefined, undefined as never);
    const text = getText(result);

    expect(observedArgs).toEqual(expect.arrayContaining(['--json', '--fixed-strings', '--', 'computeMode']));
    expect(text).toContain('src/target.ts:1:');
    expect(text).toContain('Truncated');
    expect(result.details).toMatchObject({ source: 'rg', truncated: true });
  });

  it('search_files falls back to JS scanning when rg is unavailable', async () => {
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'target.ts'), 'export function computeMode() { return "experimental"; }\n');
    const runRipgrep: RipgrepRunner = async () => {
      const err = new Error('missing rg') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    };
    const tool = createStudentSearchFilesToolDefinition(tmpDir, { runRipgrep });

    const result = await tool.execute('tool_1', { query: 'computeMode', path: 'src' }, undefined, undefined, undefined as never);

    expect(getText(result)).toContain('src/target.ts:1:');
    expect(result.details).toMatchObject({ source: 'js', count: 1 });
  });

  it('read_many reads explicit files, skips binary files, and caps total output', async () => {
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'a.txt'), 'alpha\n'.repeat(20));
    await writeFile(join(tmpDir, 'src', 'b.txt'), 'beta\n');
    await writeFile(join(tmpDir, 'src', 'binary.bin'), Buffer.from([0, 1, 2, 3, 4]));
    const tool = createStudentReadManyToolDefinition(tmpDir);

    const result = await tool.execute('tool_1', {
      paths: ['src/a.txt', 'src/b.txt', 'src/binary.bin'],
      maxCharsPerFile: 50,
      maxTotalChars: 80,
    }, undefined, undefined, undefined as never);
    const text = getText(result);

    expect(text).toContain('--- src/a.txt ---');
    expect(text).toContain('alpha');
    expect(text).toContain('--- src/b.txt ---');
    expect(text).toContain('[Skipped binary file]');
    expect(result.details?.truncated).toBe(true);
  });

  it('read_many rejects glob-like paths and directories', async () => {
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'a.txt'), 'alpha\n');
    const tool = createStudentReadManyToolDefinition(tmpDir);

    await expect(tool.execute('tool_1', { paths: ['src/*.txt'] }, undefined, undefined, undefined as never))
      .rejects.toThrow('explicit file paths only');
    await expect(tool.execute('tool_1', { paths: ['src'] }, undefined, undefined, undefined as never))
      .rejects.toThrow('cannot read directories');
  });
});

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content.find((part) => part.type === 'text')?.text;
  return typeof text === 'string' ? text : '';
}
