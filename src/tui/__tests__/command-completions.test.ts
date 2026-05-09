import { describe, expect, it } from 'vitest';
import { getCommandCompletions } from '../command-completions.js';

describe('getCommandCompletions', () => {
  it('returns subcommand completions for design study', () => {
    expect(getCommandCompletions('/design s')).toContain('/design study ');
  });

  it('returns no completions after slash is deleted', () => {
    expect(getCommandCompletions('')).toEqual([]);
    expect(getCommandCompletions('design')).toEqual([]);
  });

  it('limits visible completions', () => {
    expect(getCommandCompletions('/', 3)).toHaveLength(3);
  });
});
