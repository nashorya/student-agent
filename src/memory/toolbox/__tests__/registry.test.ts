import { access, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolboxRegistry } from '../registry.js';

const VALID_TOOL = (name: string, description = 'a test tool') => `
export default {
  name: ${JSON.stringify(name)},
  description: ${JSON.stringify(description)},
  params: { input: 'string:example' },
  async run(args) {
    return args?.input ?? 'ok';
  },
};
`;

describe('ToolboxRegistry', () => {
  let memoryDir: string;

  beforeEach(async () => {
    memoryDir = await mkdtemp(join(tmpdir(), 'toolbox-registry-'));
  });

  afterEach(async () => {
    await rm(memoryDir, { recursive: true, force: true });
  });

  it('rebuilds from disk so a second registry sees tools created by the first (ghost-tool prevention)', async () => {
    const regA = new ToolboxRegistry(memoryDir);
    await regA.load();
    await regA.createTool('summarize-test-failures', VALID_TOOL('summarize-test-failures', 'extract failures'));

    const regB = new ToolboxRegistry(memoryDir);
    await regB.load();
    const listed = regB.list();
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'summarize-test-failures',
          description: 'extract failures',
          disabled: false,
        }),
      ]),
    );
  });

  it('marks bad modules as disabled without throwing from load()', async () => {
    const toolboxDir = join(memoryDir, 'toolbox');
    await mkdir(toolboxDir, { recursive: true });
    await writeFile(
      join(toolboxDir, 'broken-tool.mjs'),
      `export default { description: 'x' };\n`,
      'utf8',
    );

    const reg = new ToolboxRegistry(memoryDir);
    await expect(reg.load()).resolves.toBeUndefined();

    const listed = reg.list();
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'broken-tool', disabled: true }),
      ]),
    );

    const described = reg.describe('broken-tool');
    expect(described).toBeDefined();
    expect(described!.loadError).toBeTruthy();
    expect(typeof described!.loadError).toBe('string');
    expect(described!.loadError!.length).toBeGreaterThan(0);
  });

  it('auto-disables after 3 consecutive failures and re-enables on updateTool', async () => {
    const name = 'flaky-tool';
    const reg = new ToolboxRegistry(memoryDir);
    await reg.load();
    await reg.createTool(name, VALID_TOOL(name));

    await reg.recordUsage(name, false);
    await reg.recordUsage(name, false);
    await reg.recordUsage(name, false);

    let desc = reg.describe(name);
    expect(desc?.stats.disabled).toBe(true);
    expect(desc?.stats.disabledReason).toBeTruthy();
    expect(desc?.stats.consecutiveFailures).toBe(3);

    await reg.updateTool(name, VALID_TOOL(name, 'fixed tool'));
    desc = reg.describe(name);
    expect(desc?.stats.disabled).toBe(false);
    expect(desc?.stats.consecutiveFailures).toBe(0);
    expect(desc?.stats.disabledReason).toBeUndefined();
    expect(desc?.description).toBe('fixed tool');
  });

  it('rolls back createTool when validation fails (no leftover .mjs)', async () => {
    const name = 'invalid-create';
    const reg = new ToolboxRegistry(memoryDir);
    await reg.load();

    const badSource = `
export default {
  name: ${JSON.stringify(name)},
  description: 'missing run',
};
`;
    await expect(reg.createTool(name, badSource)).rejects.toThrow();

    const path = reg.toolPath(name);
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('disableTool persists disabled state across reload', async () => {
    const name = 'manual-disable';
    const reg = new ToolboxRegistry(memoryDir);
    await reg.load();
    await reg.createTool(name, VALID_TOOL(name));
    await reg.disableTool(name, 'user requested');

    const reg2 = new ToolboxRegistry(memoryDir);
    await reg2.load();
    const desc = reg2.describe(name);
    expect(desc?.disabled).toBe(true);
    expect(desc?.stats.disabled).toBe(true);
    expect(desc?.stats.disabledReason).toBe('user requested');
  });

  it('recordUsage ok resets consecutiveFailures but does not re-enable', async () => {
    const name = 'disabled-but-used';
    const reg = new ToolboxRegistry(memoryDir);
    await reg.load();
    await reg.createTool(name, VALID_TOOL(name));
    await reg.disableTool(name, 'manual');
    await reg.recordUsage(name, false);
    await reg.recordUsage(name, true);

    const desc = reg.describe(name);
    expect(desc?.stats.calls).toBe(2);
    expect(desc?.stats.consecutiveFailures).toBe(0);
    expect(desc?.stats.disabled).toBe(true);
    expect(desc?.stats.disabledReason).toBe('manual');
    expect(desc?.stats.lastUsedAt).toBeTruthy();
  });
});
