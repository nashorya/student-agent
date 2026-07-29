import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createOpenCodeView } from '../opencode-view.js';
import { initialTUIV2State, tuiV2Reducer } from '../state.js';

describe('OpenCode TUI runtime', () => {
  it('keeps the v2 entrypoint independent from pi-tui', async () => {
    const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('@earendil-works/pi-tui');
    expect(source).not.toContain('./pi-runtime.js');
    expect(source).toContain('./opentui-runtime.js');
  });

  it('restores editor focus after state-driven renders', async () => {
    const source = await readFile(new URL('../opentui-runtime.ts', import.meta.url), 'utf8');

    expect(source).toContain('restoreInputCapture(mounted)');
    expect(source).toContain('mounted.input.focus()');
  });

  it('recovers input focus before key dispatch instead of during mouse handling', async () => {
    const source = await readFile(new URL('../opentui-runtime.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('root.onMouseDown');
    expect(source).not.toContain("renderer.on('focused_editor'");
    expect(source).toContain("renderer.keyInput.on('keypress'");
    expect(source).toContain('renderer.currentFocusedEditor !== input');
    expect(source).toContain('input.focus()');
  });

  it('restores raw stdin capture after state-driven renders', async () => {
    const source = await readFile(new URL('../opentui-runtime.ts', import.meta.url), 'utf8');

    expect(source).toContain('process.stdin.setRawMode(true)');
    expect(source).toContain('process.stdin.resume()');
  });

  it('handles ctrl+d at the renderer level so exit does not depend on textarea focus', async () => {
    const source = await readFile(new URL('../opentui-runtime.ts', import.meta.url), 'utf8');

    expect(source).toContain('prependInputHandlers');
    expect(source).toContain('\\x04');
    expect(source).toContain("renderer.keyInput.on('keypress'");
    expect(source).toContain("event.ctrl && event.name === 'd'");
  });

  it('keeps OpenTUI diagnostic output out of the interactive screen', async () => {
    const source = await readFile(new URL('../opentui-runtime.ts', import.meta.url), 'utf8');

    expect(source).toContain("consoleMode: 'disabled'");
    expect(source).toContain('openConsoleOnError: false');
    expect(source).toContain('redirectConsoleForTUI()');
  });

  it('projects OpenTUI message text through the markdown renderer', async () => {
    const source = await readFile(new URL('../opentui-runtime.ts', import.meta.url), 'utf8');

    expect(source).toContain('renderMarkdownLines');
    expect(source).toContain('formatMessageContent(message)');
  });

  it('renders the projected task panel lines in the OpenTUI tree', async () => {
    const source = await readFile(new URL('../opentui-runtime.ts', import.meta.url), 'utf8');

    expect(source).toContain('taskPanelBox');
    expect(source).toContain('renderTaskPanel');
    expect(source).toContain('view.taskPanelLines');
  });

  it('projects transcript, task state, and prompt metadata into an OpenCode-style view', () => {
    let state = initialTUIV2State;
    state = tuiV2Reducer(state, { type: 'APPEND_MESSAGE', role: 'user', content: 'Fix the failing test' });
    state = tuiV2Reducer(state, { type: 'STREAM_START', id: 'stream_1' });
    state = tuiV2Reducer(state, {
      type: 'STREAM_UPDATE',
      id: 'stream_1',
      text: 'I am checking the repository.',
    });
    state = tuiV2Reducer(state, {
      type: 'UPDATE_TASK_STATUS',
      status: { state: 'running', name: 'Run tests', toolCallCount: 2 },
    });

    const view = createOpenCodeView(state, {
      cwd: '/Users/test/student-agent',
      home: '/Users/test',
      model: 'openrouter/anthropic/claude-sonnet-4-6',
    });

    expect(view.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'Fix the failing test' }),
      expect.objectContaining({
        role: 'assistant',
        content: 'I am checking the repository.',
        streaming: true,
      }),
    ]);
    expect(view.status).toContain('Run tests');
    expect(view.status).toContain('2 tools');
    expect(view.footer).toContain('~/student-agent');
    expect(view.footer).toContain('claude-sonnet-4-6');
  });

  it('projects phase checklist lines for the OpenTUI task panel', () => {
    const state = tuiV2Reducer(initialTUIV2State, {
      type: 'UPDATE_TASK_STATUS',
      status: {
        name: 'AIVTuber 全栈实现',
        phaseIndex: 1,
        totalPhases: 3,
        phases: [
          { description: 'Phase 1: Audio', status: 'completed' },
          { description: 'Phase 2: Memory', status: 'in_progress' },
          { description: 'Phase 3: OBS', status: 'pending' },
        ],
        state: 'running',
      },
    });

    const view = createOpenCodeView(state, {
      cwd: '/Users/test/AIVTUBER',
      home: '/Users/test',
      columns: 60,
    });
    const text = view.taskPanelLines.join('\n');

    expect(text).toContain('AIVTuber 全栈实现');
    expect(text).toContain('✓');
    expect(text).toContain('◆');
    expect(text).toContain('○');
  });

  it('exposes slash completions as soon as the OpenTUI input contains a slash', () => {
    const state = tuiV2Reducer(initialTUIV2State, {
      type: 'SET_INPUT',
      value: '/',
      cursor: 1,
    });

    const view = createOpenCodeView(state, {
      cwd: '/Users/test/student-agent',
      home: '/Users/test',
    });

    expect(view.completions).toContain('/help');
    expect(view.completions).toContain('/quit');
    expect(view.completionRows).toBe(view.completions.length + 1);
  });

  it('reserves the full bounded height for multiline settings prompts', () => {
    const question = Array.from({ length: 14 }, (_, index) => `option ${index + 1}`).join('\n');
    const state = tuiV2Reducer(initialTUIV2State, {
      type: 'BEGIN_PROMPT',
      question,
    });

    const view = createOpenCodeView(state, {
      cwd: '/Users/test/student-agent',
      home: '/Users/test',
    });

    expect(view.promptQuestionRows).toBe(10);
  });

  it('uses Bun for the OpenTUI development and packaged launch paths', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };
    const bin = await readFile(new URL('../../../bin/student-agent', import.meta.url), 'utf8');

    expect(packageJson.scripts.dev).toBe('STUDENT_AGENT_TUI=v2 bun src/extension/index.ts');
    expect(packageJson.scripts['dev:v2']).toContain('STUDENT_AGENT_TUI=v2');
    expect(bin).toContain("process.env.STUDENT_AGENT_TUI !== 'v1'");
    expect(bin).toContain("process.env.STUDENT_AGENT_BUN || 'bun'");
  });
});
