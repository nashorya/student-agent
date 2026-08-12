import { describe, expect, it } from 'vitest';
import { TranscriptView, PlanPanel, AgentsPanel } from '../components.js';
import { sectionRailTitle, hRule } from '../chrome.js';
import { initialShellState, shellReducer, type ShellState } from '../state.js';

describe('TranscriptView activity timeline', () => {
  it('renders hierarchical labels for timeline entries', () => {
    let state = initialShellState();
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'user', content: 'hi' });
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'reasoning', content: 'plan next step' });
    state = shellReducer(state, {
      type: 'ADD_MESSAGE',
      kind: 'tool',
      content: 'bash · ls',
      meta: { toolStatus: 'done' },
    });
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'assistant', content: 'done' });
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'error', content: 'boom' });
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'recovery', content: 'retry' });
    state = shellReducer(state, { type: 'ADD_MESSAGE', kind: 'verification', content: 'vitest' });

    const view = new TranscriptView(() => state);
    const text = view.render(80).join('\n');
    expect(text).toContain('You');
    expect(text).toContain('reasoning');
    expect(text).toContain('tool');
    expect(text).toContain('Assistant');
    expect(text).toContain('error');
    expect(text).toContain('recovery');
    expect(text).toContain('verify');
  });

  it('renders empty placeholder', () => {
    const state: ShellState = initialShellState();
    const view = new TranscriptView(() => state);
    expect(view.render(40).join('\n')).toContain('Waiting for a prompt');
  });

  it('marks live reasoning while streaming', () => {
    let state = initialShellState();
    state = shellReducer(state, {
      type: 'ADD_MESSAGE',
      kind: 'reasoning',
      content: '…',
      id: 'r1',
    });
    const view = new TranscriptView(() => state);
    expect(view.render(40).join('\n')).toContain('reasoning · live');
  });
});

describe('sidebar chrome', () => {
  it('uses rail titles for Plan / Subagents', () => {
    expect(sectionRailTitle('Plan', 24)).toContain('Plan');
    expect(hRule(10)).toMatch(/─/);

    let state = initialShellState();
    const plan = new PlanPanel(() => state).render(28).join('\n');
    expect(plan).toContain('Plan');
    expect(plan).toContain('No plan yet');

    state = shellReducer(state, {
      type: 'SET_AGENTS',
      agents: [{ id: 'main', name: 'main', status: 'running' }],
    });
    const agents = new AgentsPanel(() => state).render(28).join('\n');
    expect(agents).toContain('Subagents');
    expect(agents).toContain('main');
  });

  it('does not treat markdown bullet lists as diffs', () => {
    let state = initialShellState();
    state = shellReducer(state, {
      type: 'ADD_MESSAGE',
      kind: 'assistant',
      content: '## Plan\n- step one\n- step two\n- step three',
    });
    const text = new TranscriptView(() => state).render(80).join('\n');
    // Should stay as normal assistant body (no red diff paint path required,
    // but content must still be present and not collapsed).
    expect(text).toContain('Assistant');
    expect(text).toContain('step one');
    expect(text).toContain('step two');
  });
});
