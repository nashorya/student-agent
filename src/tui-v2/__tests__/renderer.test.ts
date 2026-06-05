import { describe, expect, it } from 'vitest';
import { LineRenderer } from '../renderer.js';
import {
  AUTOWRAP_DISABLE_SEQUENCE,
  AUTOWRAP_ENABLE_SEQUENCE,
  CLEAR_VIEWPORT_SEQUENCE,
} from '../terminal-control.js';
import { createFakeTerminal } from '../test-harness.js';

describe('LineRenderer', () => {
  it('pads lines to the terminal width', () => {
    const terminal = createFakeTerminal({ columns: 12, rows: 6 });
    const renderer = new LineRenderer(terminal);

    renderer.render(['hi']);

    expect(terminal.lastFrame()).toEqual(['hi          ']);
  });

  it('wraps drawing writes with autowrap disabled to avoid bottom-row cursor wrap', () => {
    const terminal = createFakeTerminal({ columns: 12, rows: 6 });
    const renderer = new LineRenderer(terminal);

    renderer.render(['hi']);

    expect(terminal.output()).toContain(AUTOWRAP_DISABLE_SEQUENCE);
    expect(terminal.output()).toContain(AUTOWRAP_ENABLE_SEQUENCE);
    expect(terminal.output().indexOf(AUTOWRAP_DISABLE_SEQUENCE))
      .toBeLessThan(terminal.output().indexOf(AUTOWRAP_ENABLE_SEQUENCE));
  });

  it('clears rows when content shrinks', () => {
    const terminal = createFakeTerminal({ columns: 12, rows: 6 });
    const renderer = new LineRenderer(terminal);

    renderer.render(['hello world!', 'second row']);
    renderer.render(['hi']);

    expect(terminal.output()).toContain('\x1b[2K');
    expect(terminal.lastFrame()).toEqual(['hi          ']);
  });

  it('clear writes the full clear sequence and drops previous frame cache', () => {
    const terminal = createFakeTerminal({ columns: 10, rows: 4 });
    const renderer = new LineRenderer(terminal);

    renderer.render(['previous']);
    renderer.clear();
    renderer.render(['next']);

    expect(terminal.output()).toContain(CLEAR_VIEWPORT_SEQUENCE);
    expect(terminal.lastFrame()).toEqual(['next      ']);
  });
});
