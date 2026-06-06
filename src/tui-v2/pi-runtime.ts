import {
  CURSOR_MARKER,
  StdinBuffer,
  TUI,
  type Component,
  type Focusable,
  type Terminal,
} from '@earendil-works/pi-tui';
import type { TUIHandle } from '../tui/index.js';
import { createTUIV2Bridge, type TUIV2Bridge } from './bridge.js';
import type { TUIV2Action } from './events.js';
import { createInputController } from './input-controller.js';
import { renderFrame } from './layout.js';
import { initialTUIV2State, tuiV2Reducer, type TUIV2State } from './state.js';
import { CLEAR_VIEWPORT_SEQUENCE } from './terminal-control.js';

export interface TUIV2PiHandle extends Omit<TUIHandle, 'bridge'> {
  bridge: TUIV2Bridge;
}

export interface TUIV2PiRuntimeOptions {
  terminal: Terminal;
  onSubmit: (value: string) => void;
  onAbort: () => void;
  onExit?: () => void;
  onFrame?: (frame: string[]) => void;
}

class TUIV2RootComponent implements Component, Focusable {
  focused = false;
  private lastFrame: string[] = [];

  constructor(private readonly options: {
    getState: () => TUIV2State;
    getRows: () => number;
    handleInput: (data: string) => void;
    onFrame?: (frame: string[]) => void;
  }) {}

  handleInput(data: string): void {
    this.options.handleInput(data);
  }

  invalidate(): void {
    this.lastFrame = [];
  }

  render(width: number): string[] {
    const state = this.options.getState();
    const rows = Math.max(2, this.options.getRows());
    const frame = renderFrame(state, { columns: width, rows });
    this.lastFrame = [...frame];
    this.options.onFrame?.(this.lastFrame);

    if (!this.focused) return frame;
    return renderFrame(state, { columns: width, rows }, {
      inputFocused: true,
      cursorMarker: CURSOR_MARKER,
    });
  }

  frame(): string[] {
    return [...this.lastFrame];
  }
}

export function createPiTUIV2Runtime(options: TUIV2PiRuntimeOptions): TUIV2PiHandle {
  let state = initialTUIV2State;
  let streamSeq = 0;
  let exited = false;

  const tui = new TUI(options.terminal);
  tui.setClearOnShrink(true);

  const render = (force = false) => {
    tui.requestRender(force);
  };

  const dispatch = (action: TUIV2Action) => {
    state = tuiV2Reducer(state, action);
    render(action.type === 'CLEAR_SCREEN' || action.type === 'FORCE_REDRAW');
  };

  const inputController = createInputController({
    getState: () => state,
    dispatch,
    onSubmit: options.onSubmit,
    onAbort: options.onAbort,
    onExit: options.onExit,
  });

  const root = new TUIV2RootComponent({
    getState: () => state,
    getRows: () => options.terminal.rows,
    handleInput: inputController.handleData,
    onFrame: options.onFrame,
  });

  tui.addChild(root);
  tui.setFocus(root);

  const bridge = createTUIV2Bridge({
    dispatch,
    getStreamId() {
      streamSeq += 1;
      return `stream_${streamSeq}`;
    },
    prompt: inputController.prompt,
  });

  tui.start();

  // Enable mouse SGR reporting for scroll wheel support
  options.terminal.write('\x1b[?1000h\x1b[?1006h');

  return {
    bridge,
    waitForExit: async () => {
      while (!exited) await new Promise((resolve) => setTimeout(resolve, 50));
    },
    unmount() {
      if (exited) return;
      exited = true;
      // Disable mouse reporting before cleanup
      options.terminal.write('\x1b[?1006l\x1b[?1000l');
      tui.stop();
      options.terminal.write(CLEAR_VIEWPORT_SEQUENCE);
    },
  };
}

export interface TestPiTUIV2Runtime extends TUIV2PiHandle {
  receiveInput: (data: string) => void;
  flush: () => Promise<void>;
  output: () => string;
  frame: () => string[];
}

export function createPiTUIV2ForTest(options: {
  columns: number;
  rows: number;
  onSubmit: (value: string) => void;
  onAbort: () => void;
  onExit?: () => void;
}): TestPiTUIV2Runtime {
  const terminal = new FakePiTerminal(options.columns, options.rows);
  let frame: string[] = [];
  const handle = createPiTUIV2Runtime({
    terminal,
    onSubmit: options.onSubmit,
    onAbort: options.onAbort,
    onExit: options.onExit,
    onFrame: (nextFrame) => {
      frame = [...nextFrame];
    },
  });

  return {
    ...handle,
    receiveInput: (data) => terminal.receiveInput(data),
    flush: async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    },
    output: () => terminal.output(),
    frame: () => [...frame],
  };
}

class FakePiTerminal implements Terminal {
  private writes: string[] = [];
  private stdinBuffer: StdinBuffer | null = null;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  get columns(): number {
    return this.width;
  }

  get rows(): number {
    return this.height;
  }

  get kittyProtocolActive(): boolean {
    return false;
  }

  start(onInput: (data: string) => void): void {
    this.stdinBuffer = new StdinBuffer({ timeout: 10 });
    this.stdinBuffer.on('data', (sequence) => onInput(sequence));
    this.stdinBuffer.on('paste', (content) => onInput(`\x1b[200~${content}\x1b[201~`));
  }

  stop(): void {
    this.stdinBuffer?.destroy();
    this.stdinBuffer = null;
  }

  async drainInput(): Promise<void> {}

  receiveInput(data: string): void {
    this.stdinBuffer?.process(data);
  }

  write(data: string): void {
    this.writes.push(data);
  }

  moveBy(lines: number): void {
    if (lines > 0) this.write(`\x1b[${lines}B`);
    if (lines < 0) this.write(`\x1b[${-lines}A`);
  }

  hideCursor(): void {
    this.write('\x1b[?25l');
  }

  showCursor(): void {
    this.write('\x1b[?25h');
  }

  clearLine(): void {
    this.write('\x1b[K');
  }

  clearFromCursor(): void {
    this.write('\x1b[J');
  }

  clearScreen(): void {
    this.write('\x1b[2J\x1b[H');
  }

  setTitle(title: string): void {
    this.write(`\x1b]0;${title}\x07`);
  }

  setProgress(active: boolean): void {
    this.write(active ? '\x1b]9;4;3\x07' : '\x1b]9;4;0;\x07');
  }

  output(): string {
    return this.writes.join('');
  }
}
