import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runToolboxTool } from '../runner.js';

async function writeTool(dir: string, name: string, body: string): Promise<string> {
  const toolboxDir = join(dir, 'toolbox');
  await mkdir(toolboxDir, { recursive: true });
  const filePath = join(toolboxDir, `${name}.mjs`);
  await writeFile(filePath, body, 'utf8');
  return filePath;
}

describe('runToolboxTool', () => {
  let memoryDir: string;

  beforeEach(async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'toolbox-runner-'));
  });

  afterEach(async () => {
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('times out a never-resolving run without hanging', async () => {
    const filePath = await writeTool(
      memoryDir,
      'hang',
      `
export default {
  name: 'hang',
  description: 'never resolves',
  async run() {
    return new Promise(() => {});
  },
};
`,
    );

    const started = Date.now();
    const result = await runToolboxTool({ filePath, timeoutMs: 50 });
    const elapsed = Date.now() - started;

    expect(result.timedOut).toBe(true);
    expect(result.error).toMatch(/timeout|timed out/i);
    expect(elapsed).toBeLessThan(2000);
  });

  it('truncates long string results and notes truncation', async () => {
    const filePath = await writeTool(
      memoryDir,
      'long-string',
      `
export default {
  name: 'long-string',
  description: 'returns a long string',
  async run() {
    return 'x'.repeat(9000);
  },
};
`,
    );

    const result = await runToolboxTool({ filePath, maxChars: 100 });
    expect(result.truncated).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.text.startsWith('x'.repeat(100))).toBe(true);
    expect(result.text.toLowerCase()).toMatch(/truncat/);
  });

  it('returns string results as-is on the happy path', async () => {
    const filePath = await writeTool(
      memoryDir,
      'echo',
      `
export default {
  name: 'echo',
  description: 'echoes input',
  async run(args) {
    return String(args?.msg ?? '');
  },
};
`,
    );

    const result = await runToolboxTool({
      filePath,
      args: { msg: 'hello toolbox' },
    });
    expect(result).toEqual({
      text: 'hello toolbox',
      truncated: false,
      timedOut: false,
    });
  });

  it('JSON-serializes non-string return values', async () => {
    const filePath = await writeTool(
      memoryDir,
      'json-return',
      `
export default {
  name: 'json-return',
  description: 'returns an object',
  async run() {
    return { a: 1, b: ['x'] };
  },
};
`,
    );

    const result = await runToolboxTool({ filePath });
    expect(result.truncated).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ a: 1, b: ['x'] });
  });

  it('catches run() errors without throwing', async () => {
    const filePath = await writeTool(
      memoryDir,
      'throws',
      `
export default {
  name: 'throws',
  description: 'always throws',
  async run() {
    throw new Error('boom from tool');
  },
};
`,
    );

    const result = await runToolboxTool({ filePath });
    expect(result.timedOut).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.error).toMatch(/boom from tool/);
    expect(result.text).toMatch(/boom from tool/);
  });
});
