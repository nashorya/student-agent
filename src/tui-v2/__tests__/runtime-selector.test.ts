import { describe, expect, it } from 'vitest';
import { selectTUIVersion, shouldPrintLegacyBanner } from '../../tui-runtime.js';

describe('selectTUIVersion', () => {
  it('defaults to the OpenTUI runtime', () => {
    expect(selectTUIVersion({})).toBe('v2');
  });

  it('uses the legacy TUI only when explicitly requested', () => {
    expect(selectTUIVersion({ STUDENT_AGENT_TUI: 'v2' })).toBe('v2');
    expect(selectTUIVersion({ STUDENT_AGENT_TUI: 'v1' })).toBe('v1');
    expect(selectTUIVersion({ STUDENT_AGENT_TUI: 'unexpected' })).toBe('v2');
  });

  it('suppresses the legacy banner for the OpenTUI runtime', () => {
    expect(shouldPrintLegacyBanner({ STUDENT_AGENT_TUI: 'v2' })).toBe(false);
    expect(shouldPrintLegacyBanner({ STUDENT_AGENT_TUI: 'v1' })).toBe(true);
    expect(shouldPrintLegacyBanner({})).toBe(false);
  });
});
