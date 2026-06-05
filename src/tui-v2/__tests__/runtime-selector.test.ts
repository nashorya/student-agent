import { describe, expect, it } from 'vitest';
import { selectTUIVersion } from '../../tui-runtime.js';

describe('selectTUIVersion', () => {
  it('defaults to the legacy TUI', () => {
    expect(selectTUIVersion({})).toBe('v1');
  });

  it('selects v2 only when explicitly requested', () => {
    expect(selectTUIVersion({ STUDENT_AGENT_TUI: 'v2' })).toBe('v2');
    expect(selectTUIVersion({ STUDENT_AGENT_TUI: 'v1' })).toBe('v1');
    expect(selectTUIVersion({ STUDENT_AGENT_TUI: 'unexpected' })).toBe('v1');
  });
});
