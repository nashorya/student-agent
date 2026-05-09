import { describe, it, expect } from 'vitest';
import { QualityWatchdog } from '../watchdog.js';
import type { QualityFeedbackEntry } from '../feedback-collector.js';

function feedback(rating: 'up' | 'down'): QualityFeedbackEntry {
  return {
    id: `feedback_${rating}_${Math.random()}`,
    task_id: 'task',
    session_ref: 'session',
    task_description: 'task',
    rating,
    comment: '',
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('QualityWatchdog', () => {
  it('两个以上信号退化时触发告警', () => {
    const watchdog = new QualityWatchdog();

    const evaluation = watchdog.evaluate({
      feedback: [feedback('down'), feedback('down'), feedback('up')],
      benchmarkResults: [
        {
          task_id: 'bench',
          score: 0.4,
          tool_signature: [],
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      unverifiedCandidateRatio: 0.1,
    });

    expect(evaluation.shouldAlert).toBe(true);
    expect(evaluation.report).toContain('检测到多个质量信号退化');
  });

  it('单一信号退化时仅记录不告警', () => {
    const watchdog = new QualityWatchdog();

    const evaluation = watchdog.evaluate({
      feedback: [feedback('down'), feedback('down'), feedback('up')],
      benchmarkResults: [],
      unverifiedCandidateRatio: 0,
    });

    expect(evaluation.shouldAlert).toBe(false);
    expect(evaluation.report).toBeNull();
  });

  it('视觉一致性和未验证设计候选同时退化时告警', () => {
    const watchdog = new QualityWatchdog();

    const evaluation = watchdog.evaluate({
      feedback: [],
      benchmarkResults: [],
      unverifiedCandidateRatio: 0,
      unverifiedDesignCandidateRatio: 0.8,
      designCritiques: [
        {
          id: 'critique_1',
          task_id: 'task',
          profile_id: 'profile',
          url: 'http://localhost:3000',
          score: 0.5,
          scores: {
            color_match: 0.5,
            border_shadow_match: 0.5,
            typography_match: 0.5,
            component_consistency: 0.5,
            layout_density: 0.5,
            mobile_stability: 0.5,
          },
          failures: ['视觉不一致'],
          revision_required: true,
          screenshot_refs: [],
          created_at: '2026-01-01T00:00:00.000Z',
          provenance: {
            source_type: 'playwright-visual-critic',
            task_id: 'task',
            session_ref: 'session',
            created_at: '2026-01-01T00:00:00.000Z',
            trust_status: 'unverified',
          },
        },
      ],
    });

    expect(evaluation.shouldAlert).toBe(true);
    expect(evaluation.degradedSignals).toContain('视觉一致性平均分 0.50');
  });
});
