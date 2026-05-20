import { describe, expect, it } from 'vitest';
import { buildPhaseExecutionPrompt } from '../planning-prompt.js';

describe('buildPhaseExecutionPrompt', () => {
  it('uses external 1-based phase numbers in PHASE_DONE signals', () => {
    const phase1Prompt = buildPhaseExecutionPrompt('任务', '第一步', 0, 3);
    const phase3Prompt = buildPhaseExecutionPrompt('任务', '第三步', 2, 3);

    expect(phase1Prompt).toContain('[PHASE_DONE phase=1]');
    expect(phase3Prompt).toContain('[PHASE_DONE phase=3]');
  });
});
