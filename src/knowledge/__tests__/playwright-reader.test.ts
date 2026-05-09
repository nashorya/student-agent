import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlaywrightReader, type BrowserFactory } from '../playwright-reader.js';

interface MockPage {
  goto: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
  addScriptTag: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface MockContext {
  newPage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface MockBrowser {
  newContext: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function makeFactory(extracted: unknown): {
  factory: BrowserFactory;
  page: MockPage;
  context: MockContext;
  browser: MockBrowser;
} {
  const page: MockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    addScriptTag: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(extracted),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const context: MockContext = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const browser: MockBrowser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const factory: BrowserFactory = {
    launch: vi.fn().mockResolvedValue(browser),
  };

  return { factory, page, context, browser };
}

describe('PlaywrightReader', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'playwright-reader-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('使用 domcontentloaded + 固定渲染等待读取页面，不使用 networkidle', async () => {
    const { factory, page } = makeFactory({
      title: 'Docs',
      html: '<main><h1>Hello</h1><p>Rendered content</p></main>',
      text: 'Hello\nRendered content',
      usedReadability: true,
    });
    const reader = new PlaywrightReader({
      browserFactory: factory,
      readabilityScript: 'globalThis.Readability = function () {};',
    });

    const result = await reader.read('https://example.com/docs');

    expect(page.goto).toHaveBeenCalledWith('https://example.com/docs', {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });
    expect(page.waitForTimeout).toHaveBeenCalledWith(2_000);
    expect(result.markdown).toContain('# Hello');
    expect(result.markdown).toContain('Rendered content');
    expect(result.usedReadability).toBe(true);
    await reader.close();
  });

  it('默认不启用 storageState', async () => {
    const { factory, browser } = makeFactory({
      title: 'Docs',
      html: '<p>content</p>',
      text: 'content',
      usedReadability: false,
    });
    const reader = new PlaywrightReader({
      browserFactory: factory,
      readabilityScript: '',
    });

    await reader.read('https://example.com/docs');

    expect(browser.newContext).toHaveBeenCalledWith({});
    await reader.close();
  });

  it('显式 opt-in 且文件存在时读取 storageState 文件', async () => {
    const storageStatePath = join(tmpDir, 'playwright-state.json');
    await writeFile(storageStatePath, '{}');
    const { factory, browser } = makeFactory({
      title: 'Docs',
      html: '<p>content</p>',
      text: 'content',
      usedReadability: false,
    });
    const reader = new PlaywrightReader({
      browserFactory: factory,
      readabilityScript: '',
      useStorageState: true,
      storageStatePath,
    });

    await reader.read('https://example.com/docs');

    expect(browser.newContext).toHaveBeenCalledWith({ storageState: storageStatePath });
    await reader.close();
  });

  it('允许任意 http/https URL，不检查域名白名单', async () => {
    const { factory } = makeFactory({
      title: 'Any',
      html: '<p>any site</p>',
      text: 'any site',
      usedReadability: false,
    });
    const reader = new PlaywrightReader({ browserFactory: factory, readabilityScript: '' });

    const result = await reader.read('https://not-in-a-whitelist.example/private');

    expect(result.markdown).toContain('any site');
    expect(factory.launch).toHaveBeenCalled();
    await reader.close();
  });

  it('拒绝非 http/https URL，不启动浏览器', async () => {
    const { factory } = makeFactory({
      title: '',
      html: '',
      text: '',
      usedReadability: false,
    });
    const reader = new PlaywrightReader({ browserFactory: factory });

    await expect(reader.read('file:///tmp/page.html')).rejects.toThrow('仅允许 http/https');
    expect(factory.launch).not.toHaveBeenCalled();
  });
});
