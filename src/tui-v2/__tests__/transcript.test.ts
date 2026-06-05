import { describe, expect, it } from 'vitest';
import { renderTranscriptLines } from '../components/transcript.js';
import { initialTUIV2State, type TUIV2State } from '../state.js';
import { stripAnsi, visibleLength } from '../terminal-control.js';

describe('renderTranscriptLines', () => {
  it('renders committed messages plus the complete streaming output', () => {
    const state: TUIV2State = {
      ...initialTUIV2State,
      transcript: {
        nextMessageSeq: 3,
        messages: [
          { id: 'msg_1', role: 'user', content: 'hello', timestamp: 1, status: 'complete' },
          {
            id: 'msg_2',
            role: 'assistant',
            content: ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6'].join('\n'),
            timestamp: 2,
            status: 'streaming',
          },
        ],
      },
      streaming: { id: 's1', messageId: 'msg_2' },
    };

    const lines = renderTranscriptLines(state, { width: 50 });
    const text = stripAnsi(lines.join('\n'));
    const assistantHeaderIndex = lines.findIndex((line) => stripAnsi(line) === 'Assistant:');

    expect(text).toContain('> hello');
    expect(assistantHeaderIndex).toBeGreaterThanOrEqual(0);
    expect(stripAnsi(lines[assistantHeaderIndex + 1] ?? '')).toBe('line 1');
    expect(text).toContain('line 6');
  });

  it('renders committed markdown without leaking source markers', () => {
    const state: TUIV2State = {
      ...initialTUIV2State,
      transcript: {
        nextMessageSeq: 2,
        messages: [{ id: 'msg_1', role: 'assistant', content: '**done**', timestamp: 1 }],
      },
    };

    const lines = renderTranscriptLines(state, { width: 50 });
    const text = stripAnsi(lines.join('\n'));

    expect(text).toContain('Assistant:\ndone');
    expect(text).not.toContain('**');
  });

  it('keeps rendered transcript lines within the terminal width for CJK text', () => {
    const state: TUIV2State = {
      ...initialTUIV2State,
      transcript: {
        nextMessageSeq: 2,
        messages: [{ id: 'msg_1', role: 'system', content: '任务: 你好你好你好你好', timestamp: 1 }],
      },
    };

    const lines = renderTranscriptLines(state, { width: 18 });

    for (const line of lines) expect(visibleLength(line)).toBeLessThanOrEqual(18);
  });
});
