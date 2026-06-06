import { describe, expect, it } from 'vitest';
import { getCommandCompletions } from '../command-completions.js';

describe('getCommandCompletions', () => {
  it('returns no completions after slash is deleted', () => {
    expect(getCommandCompletions('')).toEqual([]);
    expect(getCommandCompletions('unknown')).toEqual([]);
  });

  it('limits visible completions', () => {
    expect(getCommandCompletions('/', 3)).toHaveLength(3);
  });
});
