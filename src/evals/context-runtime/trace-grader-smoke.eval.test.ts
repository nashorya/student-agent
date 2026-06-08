import { describe, expect, it } from 'vitest';
import { gradeTraceEvents } from '../trace-grader/trace-grader.js';
import {
  readOnlyTrace,
  successClaimOnlyTrace,
  writeAndValidationTrace,
} from './fixtures/trace-events.js';

describe('Context Runtime Eval: Trace Grader smoke guard', () => {
  it('fails success claims without tool calls', () => {
    const result = gradeTraceEvents(successClaimOnlyTrace);

    expect(result.status).toBe('fail');
    expect(result.checks.find((check) => check.id === 'fake_success_without_tools')?.status).toBe('fail');
  });

  it('fails read-only traces without write or validation evidence', () => {
    const result = gradeTraceEvents(readOnlyTrace);

    expect(result.status).toBe('fail');
    expect(result.summary.readToolCallCount).toBe(1);
    expect(result.summary.writeToolCallCount).toBe(0);
    expect(result.summary.validationCommandCount).toBe(0);
  });

  it('passes traces with write and validation evidence', () => {
    const result = gradeTraceEvents(writeAndValidationTrace);

    expect(result.status).toBe('pass');
    expect(result.summary.writeToolCallCount).toBe(1);
    expect(result.summary.validationCommandCount).toBe(1);
  });
});
