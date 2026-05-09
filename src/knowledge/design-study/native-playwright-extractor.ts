import { chromium } from 'playwright';
import type {
  ComputedStyleSample,
  DesignExtractionResult,
  DesignSampleRole,
  DesignScreenshotRef,
  DesignStyleSample,
  DesignTokens,
  DesignViewport,
} from '../../memory/design/types.js';
import type { DesignExtractionOptions, DesignExtractor, DesignStudyRequest } from './types.js';

export interface NativePlaywrightExtractorOptions {
  browserFactory?: BrowserFactory;
  navigationTimeoutMs?: number;
  renderWaitMs?: number;
  headless?: boolean;
}

export interface BrowserFactory {
  launch(options: { headless: boolean }): Promise<BrowserLike>;
}

interface BrowserLike {
  newContext(): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface PageLike {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  waitForTimeout(milliseconds: number): Promise<void>;
  setViewportSize?(viewport: { width: number; height: number }): Promise<void>;
  screenshot?(options: { fullPage: boolean }): Promise<{ toString(encoding: 'base64'): string }>;
  evaluate<T>(pageFunction: () => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface BrowserStyleSample {
  role: DesignSampleRole;
  selector: string;
  text?: string;
  box?: { x: number; y: number; width: number; height: number };
  styles: ComputedStyleSample;
}

interface BrowserExtraction {
  title: string;
  samples: BrowserStyleSample[];
}

interface DesignBrowserGlobal {
  document: {
    title?: string;
    body?: BrowserElement;
    querySelectorAll(selector: string): BrowserNodeList;
  };
  getComputedStyle(element: BrowserElement): ComputedStyleDeclarationLike;
}

interface BrowserNodeList {
  length: number;
  item(index: number): BrowserElement | null;
}

interface BrowserElement {
  textContent?: string | null;
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
}

interface ComputedStyleDeclarationLike {
  color?: string;
  backgroundColor?: string;
  border?: string;
  borderRadius?: string;
  boxShadow?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  padding?: string;
  margin?: string;
  gap?: string;
  display?: string;
}

const DEFAULT_NAVIGATION_TIMEOUT_MS = 10_000;
const DEFAULT_RENDER_WAIT_MS = 2_000;

const VIEWPORTS: Array<{ viewport: DesignViewport; width: number; height: number }> = [
  { viewport: 'desktop', width: 1440, height: 900 },
  { viewport: 'mobile', width: 390, height: 844 },
];

export class NativePlaywrightExtractor implements DesignExtractor {
  private readonly browserFactory: BrowserFactory;
  private readonly navigationTimeoutMs: number;
  private readonly renderWaitMs: number;
  private readonly headless: boolean;

  constructor(options: NativePlaywrightExtractorOptions = {}) {
    this.browserFactory = options.browserFactory ?? chromium;
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
    this.renderWaitMs = options.renderWaitMs ?? DEFAULT_RENDER_WAIT_MS;
    this.headless = options.headless ?? true;
  }

  async extract(request: DesignStudyRequest, options: DesignExtractionOptions = {}): Promise<DesignExtractionResult> {
    throwIfAborted(options.signal);
    let browser: BrowserLike | null = null;
    let context: BrowserContextLike | null = null;
    const abortResources = () => {
      void context?.close().catch(() => {});
      void browser?.close().catch(() => {});
    };
    options.signal?.addEventListener('abort', abortResources, { once: true });
    try {
      browser = await this.browserFactory.launch({ headless: this.headless });
      throwIfAborted(options.signal);
      context = await browser.newContext();
      throwIfAborted(options.signal);
      return await this.extractWithContext(context, request, options);
    } catch (err) {
      if (options.signal?.aborted) throw new Error('Design extraction aborted');
      throw err;
    } finally {
      options.signal?.removeEventListener('abort', abortResources);
      await safeClose(context);
      await safeClose(browser);
    }
  }

  private async extractWithContext(
    context: BrowserContextLike,
    request: DesignStudyRequest,
    options: DesignExtractionOptions,
  ): Promise<DesignExtractionResult> {
    const samples: DesignStyleSample[] = [];
    const screenshots: DesignScreenshotRef[] = [];
    let title = request.name ?? '';

    for (const viewport of VIEWPORTS) {
      throwIfAborted(options.signal);
      const page = await context.newPage();
      try {
        const extracted = await this.captureViewport(page, request.url, viewport, options);
        title = title || extracted.title || request.url;
        samples.push(...extracted.samples);
        screenshots.push(extracted.screenshot);
      } finally {
        await page.close();
      }
    }

    const tokens = deriveTokens(samples);
    return {
      name: request.name ?? titleFromUrlOrTitle(title, request.url),
      sourceUrls: [request.url],
      screenshots,
      samples,
      tokens,
      componentPatterns: describeComponentPatterns(samples, tokens),
      antiPatterns: inferAntiPatterns(tokens),
      provenanceSource: 'playwright-design-study',
    };
  }

  private async captureViewport(
    page: PageLike,
    url: string,
    viewport: { viewport: DesignViewport; width: number; height: number },
    options: DesignExtractionOptions,
  ): Promise<{ title: string; samples: DesignStyleSample[]; screenshot: DesignScreenshotRef }> {
    throwIfAborted(options.signal);
    await page.setViewportSize?.({ width: viewport.width, height: viewport.height });
    throwIfAborted(options.signal);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.navigationTimeoutMs });
    throwIfAborted(options.signal);
    if (this.renderWaitMs > 0) {
      await page.waitForTimeout(this.renderWaitMs);
    }
    throwIfAborted(options.signal);
    const extracted = await page.evaluate(extractDesignSamples);
    const screenshot = await this.captureScreenshot(page, viewport.viewport, viewport.width, viewport.height);
    return {
      title: extracted.title,
      samples: extracted.samples.map((sample) => ({ ...sample, viewport: viewport.viewport })),
      screenshot,
    };
  }

  private async captureScreenshot(
    page: PageLike,
    viewport: DesignViewport,
    width: number,
    height: number,
  ): Promise<DesignScreenshotRef> {
    if (!page.screenshot) {
      return { viewport, width, height };
    }
    const buffer = await page.screenshot({ fullPage: false });
    return {
      viewport,
      width,
      height,
      dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
    };
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error('Design extraction aborted');
  }
}

async function safeClose(resource: { close(): Promise<void> } | null): Promise<void> {
  try {
    await resource?.close();
  } catch {
    // Closing can race with AbortSignal cleanup; extraction errors still carry the useful cause.
  }
}

function extractDesignSamples(): BrowserExtraction {
  const browserGlobal = globalThis as unknown as DesignBrowserGlobal;
  const samples: BrowserStyleSample[] = [];
  const sampleLimitPerRole = 6;
  const selectors: Array<{ role: DesignSampleRole; selector: string }> = [
    { role: 'button', selector: 'button, [role="button"], a[href]' },
    { role: 'input', selector: 'input, textarea, select' },
    { role: 'heading', selector: 'h1, h2, h3' },
    { role: 'card', selector: 'article, section, [class*="card"], [class*="tile"]' },
    { role: 'tag', selector: '[class*="tag"], [class*="badge"], [class*="chip"]' },
    { role: 'body', selector: 'p, li' },
  ];

  for (const item of selectors) {
    const nodes = browserGlobal.document.querySelectorAll(item.selector);
    const limit = Math.min(nodes.length, sampleLimitPerRole);
    for (let index = 0; index < limit; index++) {
      const element = nodes.item(index);
      if (!element) continue;
      samples.push(sampleBrowserElement(browserGlobal, element, item.role, item.selector));
    }
  }

  if (browserGlobal.document.body) {
    samples.push(sampleBrowserElement(browserGlobal, browserGlobal.document.body, 'background', 'body'));
  }

  return {
    title: browserGlobal.document.title ?? '',
    samples,
  };
  function sampleBrowserElement(
    targetGlobal: DesignBrowserGlobal,
    element: BrowserElement,
    role: DesignSampleRole,
    selector: string,
  ): BrowserStyleSample {
    const styles = targetGlobal.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    return {
      role,
      selector,
      text: text ? text.slice(0, 120) : undefined,
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      styles: {
        color: styles.color,
        backgroundColor: styles.backgroundColor,
        border: styles.border,
        borderRadius: styles.borderRadius,
        boxShadow: styles.boxShadow,
        fontFamily: styles.fontFamily,
        fontSize: styles.fontSize,
        fontWeight: styles.fontWeight,
        lineHeight: styles.lineHeight,
        padding: styles.padding,
        margin: styles.margin,
        gap: styles.gap,
        display: styles.display,
      },
    };
  }
}

export function deriveTokens(samples: DesignStyleSample[]): DesignTokens {
  const colors = compactUnique(samples.flatMap((sample) => [
    sample.styles.color,
    sample.styles.backgroundColor,
  ]).map(normalizeCssValue));
  const backgrounds = compactUnique(samples.map((sample) => normalizeCssValue(sample.styles.backgroundColor)));
  const text = compactUnique(samples.map((sample) => normalizeCssValue(sample.styles.color)));
  const accent = colors.filter((color) => !isNeutralColor(color)).slice(0, 8);
  const borders = compactUnique(samples.map((sample) => normalizeCssValue(sample.styles.border)));

  return {
    colors: {
      ink: text.find(isDarkColor),
      background: backgrounds.slice(0, 8),
      text: text.slice(0, 8),
      accent,
    },
    border: {
      default: borders[0],
      strong: borders.find((border) => /[3-9]px/.test(border)),
    },
    shadow: compactUnique(samples.map((sample) => normalizeCssValue(sample.styles.boxShadow))).slice(0, 8),
    radius: compactUnique(samples.map((sample) => normalizeCssValue(sample.styles.borderRadius))).slice(0, 8),
    fontWeight: {
      heading: mostCommonNumericWeight(samples, 'heading'),
      body: mostCommonNumericWeight(samples, 'body'),
      button: mostCommonNumericWeight(samples, 'button'),
    },
  };
}

function describeComponentPatterns(
  samples: DesignStyleSample[],
  tokens: DesignTokens,
): Record<string, string> {
  const roles = new Set(samples.map((sample) => sample.role));
  const patterns: Record<string, string> = {};
  if (roles.has('button')) {
    patterns.button = describePattern('button', tokens);
  }
  if (roles.has('card')) {
    patterns.card = describePattern('card', tokens);
  }
  if (roles.has('input')) {
    patterns.input = describePattern('input', tokens);
  }
  if (roles.has('tag')) {
    patterns.tag = describePattern('tag', tokens);
  }
  return patterns;
}

function describePattern(role: string, tokens: DesignTokens): string {
  const parts = [role];
  if (tokens.border.strong ?? tokens.border.default) parts.push('uses visible borders');
  if (tokens.shadow.some((shadow) => shadow && shadow !== 'none')) parts.push('uses shadows');
  if (tokens.radius.length > 0) parts.push(`radius ${tokens.radius[0]}`);
  if (tokens.colors.accent.length > 0) parts.push(`accent ${tokens.colors.accent[0]}`);
  return parts.join(', ');
}

function inferAntiPatterns(tokens: DesignTokens): string[] {
  const antiPatterns = ['unverified visual generalization'];
  if (tokens.shadow.some((shadow) => /rgba/.test(shadow) && !/0px 0px/.test(shadow))) {
    antiPatterns.push('soft blurred shadows without profile confirmation');
  }
  if (!tokens.border.strong && !tokens.border.default) {
    antiPatterns.push('assuming thick borders without observed evidence');
  }
  return antiPatterns;
}

function mostCommonNumericWeight(samples: DesignStyleSample[], role: DesignSampleRole): number | undefined {
  const weights = samples
    .filter((sample) => sample.role === role)
    .map((sample) => Number.parseInt(sample.styles.fontWeight ?? '', 10))
    .filter((weight) => Number.isFinite(weight));
  return mostCommon(weights);
}

function mostCommon(values: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function compactUnique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value !== 'none' && value !== 'rgba(0, 0, 0, 0)')))];
}

function normalizeCssValue(value: string | undefined): string | undefined {
  return value?.trim();
}

function isNeutralColor(color: string): boolean {
  return /rgba?\((?:\s*\d+\s*,){2}\s*\d+/.test(color) && /(0, 0, 0|255, 255, 255|17, 17, 17)/.test(color);
}

function isDarkColor(color: string): boolean {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return false;
  const [, r, g, b] = match;
  return Number(r) + Number(g) + Number(b) < 180;
}

function titleFromUrlOrTitle(title: string, url: string): string {
  const trimmed = title.trim();
  if (trimmed) return trimmed;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
