import { describe, it, expect } from 'vitest';
import { VisualCritic } from '../visual-critic.js';
import type { DesignExtractionResult, StyleProfile } from '../../../memory/design/types.js';
import type { DesignExtractor } from '../types.js';

function profile(): StyleProfile {
  return {
    id: 'food-ui',
    candidate_id: 'candidate_1',
    name: 'Food UI',
    mood: ['colorful'],
    source_urls: ['https://example.com'],
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
    component_patterns: { button: 'hard shadow button' },
    anti_patterns: [],
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    provenance: {
      source_type: 'user-confirmed',
      task_id: 'task_1',
      session_ref: 'session_1',
      created_at: '2026-05-08T00:00:00.000Z',
      trust_status: 'user-confirmed',
    },
  };
}

function extraction(overrides: Partial<DesignExtractionResult> = {}): DesignExtractionResult {
  return {
    name: 'Food UI',
    sourceUrls: ['http://localhost:3000'],
    screenshots: [{ viewport: 'mobile', width: 390, height: 844 }],
    samples: [
      {
        role: 'button',
        selector: 'button',
        viewport: 'mobile',
        box: { x: 10, y: 10, width: 100, height: 44 },
        styles: {},
      },
    ],
    tokens: {
      colors: {
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
    antiPatterns: [],
    provenanceSource: 'playwright-design-study',
    ...overrides,
  };
}

describe('VisualCritic', () => {
  it('passes when local page matches active profile', async () => {
    const extractor: DesignExtractor = {
      extract: async () => extraction(),
    };
    const critic = new VisualCritic({ extractor, threshold: 0.8 });

    const result = await critic.critique({
      url: 'http://localhost:3000',
      profile: profile(),
      taskId: 'task_1',
      sessionRef: 'session_1',
    });

    expect(result.revision_required).toBe(false);
    expect(result.score).toBe(1);
  });

  it('treats equivalent hex and rgb tokens as matching', async () => {
    const extractor: DesignExtractor = {
      extract: async () => extraction({
        tokens: {
          colors: {
            background: ['rgb(255, 253, 248)'],
            text: ['rgb(17, 17, 17)'],
            accent: ['rgb(255, 210, 63)'],
          },
          border: { default: '3px solid rgb(17, 17, 17)' },
          shadow: ['4px 4px 0 rgb(17, 17, 17)'],
          radius: ['16px'],
          fontWeight: { button: 900 },
        },
      }),
    };
    const critic = new VisualCritic({ extractor, threshold: 0.8 });

    const result = await critic.critique({
      url: 'http://localhost:3000',
      profile: profile(),
      taskId: 'task_1',
      sessionRef: 'session_1',
    });

    expect(result.scores.color_match).toBe(1);
    expect(result.scores.border_shadow_match).toBe(1);
  });

  it('requires revision when key style dimensions diverge', async () => {
    const extractor: DesignExtractor = {
      extract: async () => extraction({
        samples: [],
        tokens: {
          colors: {
            background: ['#ffffff'],
            text: ['#666666'],
            accent: ['#cccccc'],
          },
          border: { default: '1px solid #dddddd' },
          shadow: ['none'],
          radius: ['4px'],
          fontWeight: { button: 400 },
        },
      }),
    };
    const critic = new VisualCritic({ extractor, threshold: 0.8 });

    const result = await critic.critique({
      url: 'http://localhost:3000',
      profile: profile(),
      taskId: 'task_1',
      sessionRef: 'session_1',
    });

    expect(result.revision_required).toBe(true);
    expect(result.failures).toContain('mobile viewport samples are missing or unstable');
    expect(result.score).toBeLessThan(0.8);
  });

  it('ignores profile component patterns that the extractor cannot observe', async () => {
    const extractor: DesignExtractor = {
      extract: async () => extraction(),
    };
    const richProfile = {
      ...profile(),
      component_patterns: {
        button: 'hard shadow button',
        empty_state: 'sticker empty state',
      },
    };
    const critic = new VisualCritic({ extractor, threshold: 0.8 });

    const result = await critic.critique({
      url: 'http://localhost:3000',
      profile: richProfile,
      taskId: 'task_1',
      sessionRef: 'session_1',
    });

    expect(result.scores.component_consistency).toBe(1);
    expect(result.scores.layout_density).toBe(1);
  });
});
