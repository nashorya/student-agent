import type {
  BoxRenderable,
  CliRenderer,
  ScrollBoxRenderable,
  TextareaRenderable,
  TextRenderable,
} from '@opentui/core';
import type { TUIHandle } from '../tui/index.js';
import { redirectConsoleForTUI } from '../tui/console-redirect.js';
import { createTUIV2Bridge, type TUIV2Bridge } from './bridge.js';
import { clampCompletionIndex, getCompletions } from './components/completions.js';
import type { TUIV2Action } from './events.js';
import { renderMarkdownLines } from './markdown.js';
import { createOpenCodeView } from './opencode-view.js';
import { initialTUIV2State, tuiV2Reducer, type TUIV2State } from './state.js';

export interface OpenTUIV2Handle extends Omit<TUIHandle, 'bridge'> {
  bridge: TUIV2Bridge;
}

export interface OpenTUIRuntimeOptions {
  onSubmit: (value: string) => void;
  onAbort: () => void;
  onExit?: () => void;
}

interface OpenTUIMountOptions extends OpenTUIRuntimeOptions {
  onInput: (value: string, cursor: number) => void;
  onCompletionNavigate: (direction: 'up' | 'down') => void;
  onCompletionApply: (allowFirst: boolean) => boolean;
}

interface MountedOpenTUI {
  renderer: CliRenderer;
  transcript: ScrollBoxRenderable;
  taskPanelBox: BoxRenderable;
  completionBox: BoxRenderable;
  status: TextRenderable;
  footer: TextRenderable;
  promptLabel: TextRenderable;
  input: TextareaRenderable;
  messages: Map<string, { box: BoxRenderable; text: TextRenderable }>;
  taskPanelLines: TextRenderable[];
  createMessage: (
    message: ReturnType<typeof createOpenCodeView>['messages'][number],
    index: number,
  ) => { box: BoxRenderable; text: TextRenderable };
  createTaskPanelLine: (line: string, index: number) => TextRenderable;
  createCompletion: (completion: string, index: number, selected: boolean) => TextRenderable;
}

const THEME = {
  primary: '#fab283',
  secondary: '#5c9cf5',
  error: '#e06c75',
  text: '#eeeeee',
  textMuted: '#808080',
  background: '#0a0a0a',
  backgroundPanel: '#141414',
  backgroundElement: '#1e1e1e',
  border: '#484848',
};

// Layout and palette adapted from OpenCode TUI (MIT License).
export function createOpenTUIV2Runtime(options: OpenTUIRuntimeOptions): OpenTUIV2Handle {
  const restoreConsole = redirectConsoleForTUI();
  let state = initialTUIV2State;
  let streamSeq = 0;
  let mounted: MountedOpenTUI | null = null;
  let exited = false;
  let resolveExit!: () => void;
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  const render = () => {
    if (!mounted) return;
    renderOpenCodeState(mounted, state);
  };

  const dispatch = (action: TUIV2Action) => {
    state = tuiV2Reducer(state, action);
    render();
  };

  const applyCompletion = (allowFirst: boolean): boolean => {
    const items = getCompletions(state.input.value);
    if (items.length === 0) return false;
    if (!allowFirst && state.input.completionIndex < 0) return false;
    const index = state.input.completionIndex >= 0
      ? clampCompletionIndex(items, state.input.completionIndex)
      : 0;
    const completion = items[index];
    if (!completion) return false;
    dispatch({
      type: 'SET_INPUT',
      value: completion,
      cursor: Array.from(completion).length,
    });
    return true;
  };

  const bridge = createTUIV2Bridge({
    dispatch,
    getStreamId() {
      streamSeq += 1;
      return `stream_${streamSeq}`;
    },
    prompt(question) {
      dispatch({ type: 'BEGIN_PROMPT', question });
      return new Promise<string>((resolve) => {
        settingsPrompt = { resolve };
      });
    },
  });

  let settingsPrompt: { resolve: (answer: string) => void } | null = null;

  void mountOpenTUI({
    ...options,
    onInput(value, cursor) {
      dispatch({ type: 'SET_INPUT', value, cursor });
    },
    onCompletionNavigate(direction) {
      dispatch({ type: 'COMPLETION_NAVIGATE', direction });
    },
    onCompletionApply: applyCompletion,
    onSubmit(value) {
      if (settingsPrompt) {
        const pending = settingsPrompt;
        settingsPrompt = null;
        dispatch({ type: 'END_PROMPT' });
        pending.resolve(value);
        return;
      }
      options.onSubmit(value);
    },
    onExit() {
      options.onExit?.();
      shutdown();
    },
  }).then((value) => {
    if (exited) {
      value.renderer.destroy();
      return;
    }
    mounted = value;
    render();
  }).catch((error: unknown) => {
    process.stderr.write(`[student-agent] OpenTUI failed to start: ${formatError(error)}\n`);
    options.onExit?.();
    shutdown();
  });

  function shutdown() {
    if (exited) return;
    exited = true;
    mounted?.renderer.destroy();
    mounted = null;
    restoreConsole();
    resolveExit();
  }

  return {
    bridge,
    waitForExit: () => exitPromise,
    unmount: shutdown,
  };
}

async function mountOpenTUI(
  options: OpenTUIMountOptions,
): Promise<MountedOpenTUI> {
  const {
    BoxRenderable,
    ScrollBoxRenderable,
    TextareaRenderable,
    TextRenderable,
    createCliRenderer,
  } = await import('@opentui/core');

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    clearOnShutdown: true,
    screenMode: 'alternate-screen',
    externalOutputMode: 'passthrough',
    consoleMode: 'disabled',
    openConsoleOnError: false,
    targetFps: 30,
    useMouse: true,
    useKittyKeyboard: {},
    backgroundColor: THEME.background,
    prependInputHandlers: [
      (sequence) => {
        if (sequence !== '\x04') return false;
        options.onExit?.();
        return true;
      },
    ],
  });
  const root = new BoxRenderable(renderer, {
    id: 'student-agent-root',
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    backgroundColor: THEME.background,
  });

  const transcript = new ScrollBoxRenderable(renderer, {
    id: 'student-agent-transcript',
    width: '100%',
    flexGrow: 1,
    minHeight: 0,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    stickyScroll: true,
    stickyStart: 'bottom',
    viewportCulling: true,
    verticalScrollbarOptions: {
      visible: false,
    },
  });

  const completionBox = new BoxRenderable(renderer, {
    id: 'student-agent-completions',
    width: '100%',
    height: 0,
    visible: false,
    flexDirection: 'column',
    flexShrink: 0,
    border: ['top'],
    borderColor: THEME.border,
    backgroundColor: THEME.backgroundPanel,
    paddingLeft: 2,
    paddingRight: 2,
  });

  const taskPanelBox = new BoxRenderable(renderer, {
    id: 'student-agent-task-panel',
    width: '100%',
    height: 0,
    visible: false,
    flexDirection: 'column',
    flexShrink: 0,
    border: ['top'],
    borderColor: THEME.border,
    backgroundColor: THEME.background,
  });

  const promptFrame = new BoxRenderable(renderer, {
    id: 'student-agent-prompt-frame',
    width: '100%',
    flexDirection: 'column',
    border: ['left'],
    borderColor: THEME.primary,
    backgroundColor: THEME.backgroundElement,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    paddingBottom: 1,
    flexShrink: 0,
  });

  const promptLabel = new TextRenderable(renderer, {
    id: 'student-agent-prompt-label',
    content: '',
    fg: THEME.secondary,
    width: '100%',
    height: 0,
    maxHeight: 10,
    flexShrink: 0,
    wrapMode: 'word',
  });

  const input = new TextareaRenderable(renderer, {
    id: 'student-agent-input',
    width: '100%',
    minHeight: 1,
    maxHeight: 8,
    placeholder: 'Ask anything…',
    placeholderColor: THEME.textMuted,
    backgroundColor: THEME.backgroundElement,
    focusedBackgroundColor: THEME.backgroundElement,
    textColor: THEME.text,
    focusedTextColor: THEME.text,
    cursorColor: THEME.text,
    wrapMode: 'word',
    flexShrink: 0,
    keyBindings: [
      { name: 'return', action: 'submit' },
      { name: 'kpenter', action: 'submit' },
      { name: 'return', shift: true, action: 'newline' },
    ],
    onSubmit() {
      if (options.onCompletionApply(false)) return;
      const value = input.plainText.trim();
      if (!value) return;
      input.clear();
      options.onSubmit(value);
    },
    onContentChange() {
      options.onInput(input.plainText, input.cursorOffset);
    },
    onCursorChange() {
      options.onInput(input.plainText, input.cursorOffset);
    },
    onKeyDown(event) {
      if (event.name === 'tab' && getCompletions(input.plainText).length > 0) {
        event.preventDefault();
        options.onCompletionApply(true);
        return;
      }
      if (event.name === 'up' && getCompletions(input.plainText).length > 0) {
        event.preventDefault();
        options.onCompletionNavigate('up');
        return;
      }
      if (event.name === 'down' && getCompletions(input.plainText).length > 0) {
        event.preventDefault();
        options.onCompletionNavigate('down');
        return;
      }
      if (event.ctrl && event.name === 'c') {
        event.preventDefault();
        options.onAbort();
        return;
      }
      if (event.ctrl && event.name === 'd') {
        event.preventDefault();
        options.onExit?.();
        return;
      }
    },
  });

  const promptMeta = new TextRenderable(renderer, {
    id: 'student-agent-prompt-meta',
    content: 'Student Agent  ·  OpenTUI',
    fg: THEME.primary,
    width: '100%',
    height: 1,
    flexShrink: 0,
    wrapMode: 'none',
  });

  const status = new TextRenderable(renderer, {
    id: 'student-agent-status',
    content: 'Ready',
    fg: THEME.textMuted,
    width: '100%',
    height: 1,
    flexShrink: 0,
    paddingLeft: 3,
    paddingRight: 2,
    wrapMode: 'none',
  });

  const footer = new TextRenderable(renderer, {
    id: 'student-agent-footer',
    content: process.cwd(),
    fg: THEME.textMuted,
    width: '100%',
    height: 1,
    flexShrink: 0,
    paddingLeft: 2,
    paddingRight: 2,
    wrapMode: 'none',
  });

  promptFrame.add(promptLabel);
  promptFrame.add(input);
  promptFrame.add(promptMeta);
  root.add(transcript);
  root.add(taskPanelBox);
  root.add(completionBox);
  root.add(promptFrame);
  root.add(status);
  root.add(footer);
  renderer.root.add(root);
  renderer.keyInput.on('keypress', (event) => {
    if (event.ctrl && event.name === 'd') {
      event.preventDefault();
      options.onExit?.();
      return;
    }
    if (renderer.currentFocusedEditor !== input && !input.isDestroyed) {
      input.focus();
    }
  });
  input.focus();
  renderer.requestRender();

  return {
    renderer,
    transcript,
    taskPanelBox,
    completionBox,
    status,
    footer,
    promptLabel,
    input,
    messages: new Map(),
    taskPanelLines: [],
    createMessage(message, index) {
      const isUser = message.role === 'user';
      const content = new TextRenderable(renderer, {
        id: `message-text-${message.id}`,
        content: formatMessageContent(message),
        fg: message.role === 'error' ? THEME.error : THEME.text,
        width: '100%',
        wrapMode: 'word',
      });
      const box = new BoxRenderable(renderer, {
        id: `message-${message.id}`,
        width: '100%',
        flexDirection: 'column',
        flexShrink: 0,
        marginTop: index === 0 ? 0 : 1,
        paddingLeft: isUser ? 2 : 0,
        paddingRight: isUser ? 2 : 0,
        paddingTop: isUser ? 1 : 0,
        paddingBottom: isUser ? 1 : 0,
        ...(isUser
          ? {
              border: ['left'] as const,
              borderColor: THEME.primary,
              backgroundColor: THEME.backgroundPanel,
            }
          : {}),
      });
      box.add(content);
      return { box, text: content };
    },
    createTaskPanelLine(line, index) {
      return new TextRenderable(renderer, {
        id: `task-panel-line-${index}`,
        content: line,
        fg: THEME.textMuted,
        width: '100%',
        height: 1,
        flexShrink: 0,
        wrapMode: 'none',
      });
    },
    createCompletion(completion, index, selected) {
      return new TextRenderable(renderer, {
        id: `completion-${index}`,
        content: `${selected ? '›' : ' '} ${completion}`,
        fg: selected ? THEME.background : THEME.text,
        bg: selected ? THEME.primary : THEME.backgroundPanel,
        width: '100%',
        height: 1,
        flexShrink: 0,
        wrapMode: 'none',
      });
    },
  };
}

function renderOpenCodeState(mounted: MountedOpenTUI, state: TUIV2State): void {
  const view = createOpenCodeView(state, {
    cwd: process.cwd(),
    home: process.env.HOME,
    model: process.env.STUDENT_AGENT_MODEL,
    columns: process.stdout.columns ?? 80,
  });

  replaceTranscript(mounted, view.messages);
  renderTaskPanel(mounted, view.taskPanelLines);
  renderCompletions(mounted, view.completions, state.input.completionIndex);
  mounted.status.content = view.status;
  mounted.status.fg = state.taskPanel?.state === 'failed' ? THEME.error : THEME.textMuted;
  mounted.footer.content = view.footer;
  mounted.promptLabel.content = view.promptQuestion ? `${view.promptQuestion}\n` : '';
  mounted.promptLabel.height = view.promptQuestionRows;
  if (mounted.input.plainText !== state.input.value) {
    mounted.input.setText(state.input.value);
    mounted.input.cursorOffset = state.input.cursor;
  }
  restoreInputCapture(mounted);
  mounted.renderer.requestRender();
}

function restoreInputCapture(mounted: Pick<MountedOpenTUI, 'renderer' | 'input'>): void {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    try {
      process.stdin.setRawMode(true);
    } catch {
      // Some test/embedded terminals expose setRawMode but reject state changes.
    }
  }
  process.stdin.resume();
  if (mounted.renderer.currentFocusedEditor !== mounted.input) {
    mounted.input.focus();
  }
}

function renderTaskPanel(mounted: MountedOpenTUI, lines: string[]): void {
  for (const line of mounted.taskPanelLines) {
    line.destroyRecursively();
  }
  mounted.taskPanelLines = [];
  mounted.taskPanelBox.visible = lines.length > 0;
  mounted.taskPanelBox.height = lines.length > 0 ? lines.length + 1 : 0;
  if (lines.length === 0) return;

  for (const [index, line] of lines.entries()) {
    const item = mounted.createTaskPanelLine(line, index);
    mounted.taskPanelLines.push(item);
    mounted.taskPanelBox.add(item);
  }
}

function renderCompletions(
  mounted: MountedOpenTUI,
  completions: string[],
  rawIndex: number,
): void {
  for (const child of mounted.completionBox.getChildren()) {
    child.destroyRecursively();
  }

  mounted.completionBox.visible = completions.length > 0;
  mounted.completionBox.height = completions.length > 0 ? completions.length + 1 : 0;
  if (completions.length === 0) return;

  const selected = rawIndex >= 0 ? clampCompletionIndex(completions, rawIndex) : -1;
  for (const [index, completion] of completions.entries()) {
    mounted.completionBox.add(mounted.createCompletion(completion, index, index === selected));
  }
}

function replaceTranscript(
  mounted: MountedOpenTUI,
  messages: ReturnType<typeof createOpenCodeView>['messages'],
): void {
  const nextIds = new Set(messages.map((message) => message.id));
  for (const [id, node] of mounted.messages) {
    if (nextIds.has(id)) continue;
    node.box.destroyRecursively();
    mounted.messages.delete(id);
  }

  for (const [index, message] of messages.entries()) {
    const existing = mounted.messages.get(message.id);
    if (existing) {
      existing.text.content = formatMessageContent(message);
      existing.text.fg = message.role === 'error' ? THEME.error : THEME.text;
      continue;
    }

    const node = mounted.createMessage(message, index);
    mounted.messages.set(message.id, node);
    mounted.transcript.add(node.box);
  }

  mounted.transcript.scrollTo(Number.MAX_SAFE_INTEGER);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatMessageContent(
  message: ReturnType<typeof createOpenCodeView>['messages'][number],
): string {
  const fallback = message.streaming ? '…' : '';
  const raw = message.content || fallback;
  if (!raw) return '';
  const width = Math.max(20, (process.stdout.columns ?? 80) - 6);
  return renderMarkdownLines(raw, { width, streaming: message.streaming }).join('\n');
}
