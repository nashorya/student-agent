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

});
