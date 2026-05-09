import { describe, it, expect, vi } from 'vitest';
import { DembrandtExtractor } from '../dembrandt-extractor.js';

describe('DembrandtExtractor', () => {
  it('runs configured command and normalizes JSON output', async () => {
    const execFileFn = vi.fn((_file, _args, _options, callback) => {
      callback(null, JSON.stringify({
        name: 'Dembrandt UI',
        sourceUrls: ['https://example.com'],
        tokens: {
          colors: {
            ink: '#111111',
            background: ['#fffdf8'],
            text: ['#111111'],
            accent: ['#ffd23f'],
          },
          border: { default: '3px solid #111111' },
          shadow: ['4px 4px 0 #111111'],
          radius: ['16px'],
          fontWeight: { button: 900 },
        },
        componentPatterns: { button: 'hard shadow button' },
        antiPatterns: ['glassmorphism'],
      }), '');
    });
    const extractor = new DembrandtExtractor({
      command: 'dembrandt extract',
      execFileFn,
    });

    const result = await extractor.extract({ url: 'https://example.com' });

    expect(execFileFn).toHaveBeenCalledWith(
      'dembrandt',
      ['extract', 'https://example.com', '--json'],
      { timeout: 120_000 },
      expect.any(Function),
    );
    expect(result.name).toBe('Dembrandt UI');
    expect(result.provenanceSource).toBe('dembrandt-design-study');
    expect(result.tokens.colors.accent).toEqual(['#ffd23f']);
    expect(result.componentPatterns.button).toBe('hard shadow button');
  });
});
