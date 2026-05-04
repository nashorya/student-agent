import { access, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { constants } from 'node:fs';
import { chromium } from 'playwright';
import TurndownService from 'turndown';
import { DomainWhitelist } from './domain-whitelist.js';

export interface PlaywrightReaderOptions {
  whitelist?: DomainWhitelist;
  maxChars?: number;
  navigationTimeoutMs?: number;
  renderWaitMs?: number;
  headless?: boolean;
  useStorageState?: boolean;
  storageStatePath?: string;
  browserFactory?: BrowserFactory;
  readabilityScript?: string;
}

export interface ReadPageResult {
  url: string;
  title: string;
  markdown: string;
  usedReadability: boolean;
}

export interface BrowserFactory {
  launch(options: { headless: boolean }): Promise<BrowserLike>;
}

interface BrowserLike {
  newContext(options?: BrowserContextSetup): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface PageLike {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  waitForTimeout(milliseconds: number): Promise<void>;
  addScriptTag(options: { content: string }): Promise<unknown>;
  evaluate<T>(pageFunction: () => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface BrowserContextSetup {
  storageState?: string;
}

interface ExtractedContent {
  title: string;
  html: string;
  text: string;
  usedReadability: boolean;
}

type BrowserGlobal = typeof globalThis & {
  document: {
    title?: string;
    cloneNode(deep: boolean): unknown;
    body?: {
      innerHTML?: string;
      innerText?: string;
      textContent?: string;
    };
  };
  Readability?: new (document: unknown) => {
    parse(): {
      title?: string;
      content?: string;
      textContent?: string;
    } | null;
  };
};

const DEFAULT_MAX_CHARS = 5_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 10_000;
const DEFAULT_RENDER_WAIT_MS = 2_000;
const DEFAULT_STORAGE_STATE_PATH = join(homedir(), '.student-agent', 'playwright-state.json');

const require = createRequire(import.meta.url);

export class PlaywrightReader {
  private readonly whitelist: DomainWhitelist;
  private readonly maxChars: number;
  private readonly navigationTimeoutMs: number;
  private readonly renderWaitMs: number;
  private readonly headless: boolean;
  private readonly useStorageState: boolean;
  private readonly storageStatePath: string;
  private readonly browserFactory: BrowserFactory;
  private readonly readabilityScript?: string;
  private readonly turndown: TurndownService;

  private browser: BrowserLike | null = null;
  private context: BrowserContextLike | null = null;
  private resolvedReadabilityScript: string | null = null;

  constructor(options: PlaywrightReaderOptions = {}) {
    this.whitelist = options.whitelist ?? new DomainWhitelist();
    this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
    this.renderWaitMs = options.renderWaitMs ?? DEFAULT_RENDER_WAIT_MS;
    this.headless = options.headless ?? true;
    this.useStorageState = options.useStorageState ?? false;
    this.storageStatePath = options.storageStatePath ?? DEFAULT_STORAGE_STATE_PATH;
    this.browserFactory = options.browserFactory ?? chromium;
    this.readabilityScript = options.readabilityScript;
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
  }

  async read(url: string): Promise<ReadPageResult> {
    const decision = this.whitelist.check(url);
    if (!decision.allowed) {
      throw new Error(decision.reason ?? 'URL 不在 Playwright 读取白名单中');
    }

    const context = await this.ensureContext();
    const page = await context.newPage();
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.navigationTimeoutMs,
      });
      if (this.renderWaitMs > 0) {
        await page.waitForTimeout(this.renderWaitMs);
      }

      await page.addScriptTag({ content: await this.loadReadabilityScript() });
      const extracted = await page.evaluate(extractPageContent);
      const markdown = this.toMarkdown(extracted);

      return {
        url,
        title: extracted.title,
        markdown,
        usedReadability: extracted.usedReadability,
      };
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    const context = this.context;
    const browser = this.browser;
    this.context = null;
    this.browser = null;

    if (context) {
      await context.close();
    }
    if (browser) {
      await browser.close();
    }
  }

  private async ensureContext(): Promise<BrowserContextLike> {
    if (this.context) {
      return this.context;
    }

    this.browser = await this.browserFactory.launch({ headless: this.headless });
    this.context = await this.browser.newContext(await this.buildContextSetup());
    return this.context;
  }

  private async buildContextSetup(): Promise<BrowserContextSetup> {
    if (!this.useStorageState) {
      return {};
    }

    if (!(await fileExists(this.storageStatePath))) {
      return {};
    }

    return { storageState: this.storageStatePath };
  }

  private async loadReadabilityScript(): Promise<string> {
    if (this.resolvedReadabilityScript) {
      return this.resolvedReadabilityScript;
    }

    if (this.readabilityScript) {
      this.resolvedReadabilityScript = this.readabilityScript;
      return this.resolvedReadabilityScript;
    }

    const readabilityPath = require.resolve('@mozilla/readability/Readability.js');
    const source = await readFile(readabilityPath, 'utf8');
    this.resolvedReadabilityScript = `${source}\nglobalThis.Readability = Readability;`;
    return this.resolvedReadabilityScript;
  }

  private toMarkdown(extracted: ExtractedContent): string {
    const markdown = extracted.html
      ? this.turndown.turndown(extracted.html)
      : extracted.text;
    return truncateMarkdown(markdown, this.maxChars);
  }
}

export async function ensureStorageStateDirectory(path = DEFAULT_STORAGE_STATE_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

function extractPageContent(): ExtractedContent {
  const browserGlobal = globalThis as BrowserGlobal;
  const title = browserGlobal.document.title ?? '';

  if (browserGlobal.Readability) {
    const article = new browserGlobal.Readability(
      browserGlobal.document.cloneNode(true),
    ).parse();

    if (article?.content) {
      return {
        title: article.title ?? title,
        html: article.content,
        text: article.textContent ?? '',
        usedReadability: true,
      };
    }
  }

  const body = browserGlobal.document.body;
  return {
    title,
    html: body?.innerHTML ?? '',
    text: body?.innerText ?? body?.textContent ?? '',
    usedReadability: false,
  };
}

function truncateMarkdown(markdown: string, maxChars: number): string {
  const normalized = markdown
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars).trimEnd()}\n\n[页面内容已截断]`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
