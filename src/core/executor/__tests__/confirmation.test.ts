import { describe, expect, it } from 'vitest';
import { parseConfirmationAnswer } from '../confirmation.js';

describe('parseConfirmationAnswer', () => {
  it.each(['y', 'yes', '确认', 'allow', 'ok'])('allows once for %s', (answer) => {
    expect(parseConfirmationAnswer(answer)).toBe(true);
  });

  it.each(['a', 'always', '本会话', 'session'])('allows for session for %s', (answer) => {
    expect(parseConfirmationAnswer(answer)).toBe('always');
  });

  it.each(['', 'n', 'no', 'cancel', 'anything else'])('blocks for %s', (answer) => {
    expect(parseConfirmationAnswer(answer)).toBe(false);
  });
});
