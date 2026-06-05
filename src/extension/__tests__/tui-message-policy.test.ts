import { describe, expect, it } from 'vitest';
import {
  formatPlanningFailureStatus,
  shouldShowAgentErrorMessage,
} from '../tui-message-policy.js';

describe('tui message policy', () => {
  it('suppresses abort errors from transcript-level agent error output', () => {
    expect(shouldShowAgentErrorMessage('Request was aborted.')).toBe(false);
    expect(shouldShowAgentErrorMessage('request was aborted')).toBe(false);
  });

  it('keeps non-abort agent errors visible', () => {
    expect(shouldShowAgentErrorMessage('Model request failed')).toBe(true);
  });

  it('formats planning failures as concise status text', () => {
    expect(formatPlanningFailureStatus('missing-task-start')).toBe('规划失败：未输出 TASK_START');
    expect(formatPlanningFailureStatus('error', new Error('read failed'))).toBe('规划失败：read failed');
  });
});
