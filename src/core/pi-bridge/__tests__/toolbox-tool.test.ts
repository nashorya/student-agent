import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TOOLBOX_ADOPTION_GUIDELINE,
  createToolboxToolDefinition,
} from '../toolbox-tool.js';

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

function validToolSource(name: string, description = 'echo input'): string {
  return `
export default {
  name: ${JSON.stringify(name)},
  description: ${JSON.stringify(description)},
  params: { input: 'string:example' },
  async run(args) {
    return args?.input ?? 'ok';
  },
};
`;
}

describe('toolbox tool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'toolbox-tool-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('exposes adoption guideline in promptGuidelines', () => {
    const tool = createToolboxToolDefinition({ memoryDir: tmpDir });
    expect(tool.name).toBe('toolbox');
    expect(tool.promptGuidelines).toEqual(expect.arrayContaining([TOOLBOX_ADOPTION_GUIDELINE]));
    expect(TOOLBOX_ADOPTION_GUIDELINE).toMatchSnapshot();
    expect(TOOLBOX_ADOPTION_GUIDELINE).toContain('第二次');
    expect(TOOLBOX_ADOPTION_GUIDELINE).toContain('toolbox create');
    expect(TOOLBOX_ADOPTION_GUIDELINE).toContain('恰好需要的信息');
  });

  it('list on empty dir returns a short no-tools line without source', async () => {
    const tool = createToolboxToolDefinition({ memoryDir: tmpDir });
    const result = await tool.execute('tc1', { action: 'list' });
    const text = resultText(result);
    expect(text.toLowerCase()).toMatch(/no tools|empty|none/i);
    expect(text).not.toContain('export default');
    expect(text).not.toContain('async run');
  });

  it('create → list → describe → run happy path; create text is one line without source', async () => {
    const tool = createToolboxToolDefinition({ memoryDir: tmpDir });
    const name = 'echo-input';
    const source = validToolSource(name, 'echoes the input arg');

    const createResult = await tool.execute('tc2', { action: 'create', name, source });
    const createText = resultText(createResult);
    expect(createText).toMatch(/^Created tool echo-input\.$/);
    expect(createText).not.toContain('\n');
    expect(createText).not.toContain(source);
    expect(createText).not.toContain('export default');

    const listText = resultText(await tool.execute('tc3', { action: 'list' }));
    expect(listText).toContain(name);
    expect(listText).toContain('echoes the input arg');
    expect(listText).not.toContain('export default');

    const describeText = resultText(await tool.execute('tc4', { action: 'describe', name }));
    expect(describeText).toContain(name);
    expect(describeText).toContain('echoes the input arg');
    expect(describeText).toMatch(/params|input/i);
    expect(describeText).toMatch(/calls|consecutiveFailures|disabled/i);
    expect(describeText).not.toContain(source);

    const runText = resultText(await tool.execute('tc5', {
      action: 'run',
      name,
      args: { input: 'hello-toolbox' },
    }));
    expect(runText).toContain('hello-toolbox');
  });

  it('create invalid rolls back: error text and no leftover .mjs', async () => {
    const tool = createToolboxToolDefinition({ memoryDir: tmpDir });
    const name = 'broken-create';
    const source = `
export default {
  name: ${JSON.stringify(name)},
  description: 'missing run',
};
`;
    const result = await tool.execute('tc6', { action: 'create', name, source });
    const text = resultText(result);
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).toMatch(/run|invalid|must/i);
    expect(text).not.toMatch(/^Created /);

    await expect(access(join(tmpDir, 'toolbox', `${name}.mjs`))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('disabled run returns reason and does not execute', async () => {
    const tool = createToolboxToolDefinition({ memoryDir: tmpDir });
    const name = 'should-not-run';
    const source = `
export default {
  name: ${JSON.stringify(name)},
  description: 'must not run when disabled',
  async run() {
    return 'SHOULD_NOT_RUN';
  },
};
`;
    await tool.execute('tc7', { action: 'create', name, source });
    const disableText = resultText(await tool.execute('tc8', { action: 'disable', name }));
    expect(disableText.toLowerCase()).toMatch(/disabled/);

    const runText = resultText(await tool.execute('tc9', { action: 'run', name }));
    expect(runText).toMatch(/disabled/i);
    expect(runText).not.toContain('SHOULD_NOT_RUN');
  });

  it('auto-disables after 3 consecutive run failures; fourth run is disabled reason', async () => {
    const tool = createToolboxToolDefinition({ memoryDir: tmpDir });
    const name = 'always-throws';
    const source = `
export default {
  name: ${JSON.stringify(name)},
  description: 'throws every time',
  async run() {
    throw new Error('boom-from-tool');
  },
};
`;
    await tool.execute('tc10', { action: 'create', name, source });

    for (let i = 0; i < 3; i++) {
      const text = resultText(await tool.execute(`fail_${i}`, { action: 'run', name }));
      expect(text).toContain('boom-from-tool');
    }

    const fourth = resultText(await tool.execute('fail_3', { action: 'run', name }));
    expect(fourth).toMatch(/disabled|auto-disabled|consecutive/i);
    expect(fourth).not.toContain('boom-from-tool');
  });
});
