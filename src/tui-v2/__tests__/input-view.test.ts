import { describe, expect, it } from 'vitest';
import {
  getInputCursorColumn,
  renderInputLine,
} from '../components/input.js';
import { initialTUIV2State, tuiV2Reducer } from '../state.js';
import { visibleLength } from '../terminal-control.js';

describe('input view', () => {
  it('keeps the cursor visible and movable for long input', () => {
    let state = tuiV2Reducer(initialTUIV2State, {
      type: 'SET_INPUT',
      value: 'abcdefghijklmnopqrstuvwxyz',
      cursor: 26,
    });

    expect(visibleLength(renderInputLine(state, 12))).toBe(12);
    expect(getInputCursorColumn(state, 12)).toBe(12);

    state = tuiV2Reducer(state, { type: 'MOVE_CURSOR', direction: 'left' });

    expect(visibleLength(renderInputLine(state, 12))).toBe(12);
    expect(getInputCursorColumn(state, 12)).toBe(11);
  });

  it('keeps CJK cursor movement visible inside the input viewport', () => {
    let state = tuiV2Reducer(initialTUIV2State, {
      type: 'SET_INPUT',
      value: '你好你好你好你好',
      cursor: 8,
    });

    expect(getInputCursorColumn(state, 12)).toBe(12);

    state = tuiV2Reducer(state, { type: 'MOVE_CURSOR', direction: 'left' });

    expect(getInputCursorColumn(state, 12)).toBe(11);
  });

  it('keeps the prompt prefix visible for long mixed-width input', () => {
    const value = '按 Enter 后应作为一次完整输入提交 input suffix';
    const state = tuiV2Reducer(initialTUIV2State, {
      type: 'SET_INPUT',
      value,
      cursor: Array.from(value).length,
    });

    const line = renderInputLine(state, 30);

    expect(line.startsWith('> ')).toBe(true);
    expect(line).toContain('input suffix');
    expect(visibleLength(line)).toBe(30);
    expect(getInputCursorColumn(state, 30)).toBe(30);
  });
});
