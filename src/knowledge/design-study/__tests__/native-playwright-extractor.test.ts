import { describe, it, expect, vi } from 'vitest';
import { NativePlaywrightExtractor, type BrowserFactory } from '../native-playwright-extractor.js';

function makeFactory(): BrowserFactory {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
    evaluate: vi.fn().mockResolvedValue({
      title: 'Reference UI',
      samples: [
        {
          role: 'button',
          selector: 'button',
          text: 'Order',
          box: { x: 10, y: 10, width: 120, height: 44 },
          styles: {
            color: 'rgb(17, 17, 17)',
            backgroundColor: 'rgb(255, 210, 63)',
            border: '3px solid rgb(17, 17, 17)',
            borderRadius: '16px',
            boxShadow: '4px 4px 0 rgb(17, 17, 17)',
            fontWeight: '900',
          },
        },
        {
          role: 'heading',
          selector: 'h1',
          styles: {
            color: 'rgb(17, 17, 17)',
            backgroundColor: 'rgba(0, 0, 0, 0)',
            fontWeight: '900',
          },
        },
      ],
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    launch: vi.fn().mockResolvedValue(browser),
  };
}

describe('NativePlaywrightExtractor', () => {
  it('captures desktop and mobile style samples without real network', async () => {
    const factory = makeFactory();
    const extractor = new NativePlaywrightExtractor({
      browserFactory: factory,
      renderWaitMs: 0,
    });

    const result = await extractor.extract({ url: 'https://example.com', name: 'Food UI' });

    expect(result.name).toBe('Food UI');
    expect(result.samples).toHaveLength(4);
    expect(result.screenshots).toHaveLength(2);
    expect(result.tokens.border.strong).toBe('3px solid rgb(17, 17, 17)');
    expect(result.tokens.shadow).toContain('4px 4px 0 rgb(17, 17, 17)');
    expect(result.componentPatterns.button).toContain('button');
  });
});
