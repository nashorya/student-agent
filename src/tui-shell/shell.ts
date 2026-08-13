import {
  CombinedAutocompleteProvider,
  Editor,
  HStack,
  SelectList,
  matchesKey,
  ProcessTerminal,
  ScrollView,
  TuiAltScreen,
  VStack,
  isViewportTUI,
  type Component,
  type SelectItem,
} from '@earendil-works/pi-tui';
import { SLASH_MENU_COMMANDS } from '../cli/command-parser.js';
import { getProjectCwd } from '../core/paths.js';
import { setTuiMode } from '../runtime/logger.js';
import type { UiBridge } from '../runtime/ui-bridge.js';
import { createShellBridge, type ShellUiBridge } from './bridge.js';
import {
  ComposerLabel,
  SidebarFrame,
  StatusBar,
  WorkspaceHeader,
} from './chrome.js';
import {
  AgentsPanel,
  CompactOverlayPanel,
  PlanPanel,
  SidebarSectionGap,
  TranscriptView,
} from './components.js';
import { isWide, rightRailBasis, cycleCompactOverlay } from './layout.js';
import {
  DISABLE_MOUSE_TRACKING,
  classifyShellShortcut,
  createInputGate,
  filterIncomingChunk,
  scrubComposerBuffer,
} from './scrub-input.js';
import {
  sessionEntriesToSelectItems,
  type SessionPickEntry,
} from './session-picker.js';
import {
  initialShellState,
  shellReducer,
  type CompactOverlay,
  type ShellAction,
  type ShellAgentRow,
  type ShellPlanStep,
  type ShellState,
} from './state.js';
import { editorTheme, theme } from './theme.js';

export interface StartShellOptions {
  onSubmit: (value: string) => void;
  onAbort: () => void;
  onExit: () => void;
  getStatusMeta?: () => { model?: string; mode?: string };
  /** Called after transcript-affecting mutations (debounced by caller if needed). */
  onTranscriptChange?: (messages: import('./state.js').ShellMessage[]) => void;
}

export interface ShellHandle {
  bridge: UiBridge;
  waitForExit: () => Promise<void>;
  unmount: () => void;
  setPlanSteps: (steps: ShellPlanStep[]) => void;
  setAgents: (agents: ShellAgentRow[]) => void;
  setPendingCount: (count: number) => void;
  setCompactOverlay: (overlay: CompactOverlay) => void;
  setMemorySnapshot: (text: string) => void;
  clearTranscript: () => void;
  loadTranscript: (messages: import('./state.js').ShellMessage[]) => void;
  /**
   * Codex-style resume picker. Returns selected session id, or null if cancelled / empty.
   * Session ids are never shown in labels — only used as the return value.
   */
  pickSession: (
    entries: SessionPickEntry[],
    options?: { currentId?: string | null; title?: string },
  ) => Promise<string | null>;
  getState: () => ShellState;
}

/**
 * promptSettings: question lands in transcript as Ask; answer via bottom Composer.
 * No centered overlay — keeps Composer as the only input region.
 */
export function startShell(options: StartShellOptions): ShellHandle {
  let state = initialShellState();
  const getState = () => state;

  const terminal = new ProcessTerminal();
  // Mouse tracking is off: on WSL / Windows Terminal, unconsumed SGR mouse
  // sequences were leaking into the Composer as literal `^[[<…M` text.
  const tui = new TuiAltScreen(terminal, true, undefined, { mouse: false });

  let exitResolve: (() => void) | null = null;
  const exitPromise = new Promise<void>((resolve) => {
    exitResolve = resolve;
  });
  let unmounted = false;

  const requestRender = (force = false) => {
    if (unmounted) return;
    if (force) tui.renderNow(true);
    else tui.requestRender();
  };

  const dispatch = (action: ShellAction) => {
    state = shellReducer(state, action);
    if (
      action.type === 'ADD_MESSAGE'
      || action.type === 'UPDATE_STREAM'
      || action.type === 'UPDATE_LAST_MESSAGE'
      || action.type === 'END_STREAM'
      || action.type === 'END_ASSISTANT_MESSAGE'
      || action.type === 'DISCARD_STREAM'
      || action.type === 'DISCARD_ASSISTANT_MESSAGE'
      || action.type === 'CLEAR_TRANSCRIPT'
      || action.type === 'LOAD_TRANSCRIPT'
    ) {
      options.onTranscriptChange?.(state.messages);
    }
  };

  let pendingPrompt: { resolve: (answer: string) => void } | null = null;
  let sessionPicker: {
    list: SelectList;
    resolve: (id: string | null) => void;
    title: string;
  } | null = null;

  const selectListTheme = editorTheme.selectList ?? {
    selectedPrefix: (text: string) => theme.accent(text),
    selectedText: (text: string) => theme.accent(text),
    description: (text: string) => theme.muted(text),
    scrollInfo: (text: string) => theme.muted(text),
    noMatch: (text: string) => theme.warning(text),
  };

  const promptSettings = async (question: string): Promise<string> => {
    if (sessionPicker) {
      const closer = sessionPicker;
      sessionPicker = null;
      closer.resolve(null);
    }
    if (pendingPrompt) {
      pendingPrompt.resolve('');
      pendingPrompt = null;
    }

    dispatch({
      type: 'ADD_MESSAGE',
      kind: 'prompt',
      content: question.trim() || '(input required)',
    });
    dispatch({ type: 'SET_STATUS', text: 'answering prompt' });
    applyLayout();
    tui.setFocus(editor);

    return new Promise<string>((resolve) => {
      pendingPrompt = { resolve };
    });
  };

  const bridge: ShellUiBridge = createShellBridge({
    getState,
    dispatch,
    requestRender,
    promptSettings,
  });

  const getMeta = () => options.getStatusMeta?.() ?? {};
  const getColumns = () => terminal.columns || process.stdout.columns || 80;

  const header = new WorkspaceHeader(getState, getMeta);
  const transcript = new TranscriptView(getState);
  const planPanel = new PlanPanel(getState);
  const agentsPanel = new AgentsPanel(getState);
  const compactOverlay = new CompactOverlayPanel(getState);
  const composerLabel = new ComposerLabel(getState);
  const statusBar = new StatusBar(getState, getMeta, getColumns);
  const sectionGap = new SidebarSectionGap();

  const resumePickerLabel: Component = {
    invalidate() {},
    render(_width: number) {
      const title = sessionPicker?.title ?? 'Resume';
      return [
        theme.accent(title) + theme.muted('  ›  ↑↓ 选择 · Enter 确认 · Esc 取消'),
      ];
    },
  };

  const closeSessionPicker = (id: string | null) => {
    if (!sessionPicker) return;
    const closer = sessionPicker;
    sessionPicker = null;
    dispatch({ type: 'CLEAR_STATUS' });
    applyLayout();
    closer.resolve(id);
  };

  const pickSession = (
    entries: SessionPickEntry[],
    pickOptions?: { currentId?: string | null; title?: string },
  ): Promise<string | null> => {
    if (unmounted) return Promise.resolve(null);
    if (entries.length === 0) return Promise.resolve(null);

    if (sessionPicker) {
      const prev = sessionPicker;
      sessionPicker = null;
      prev.resolve(null);
    }

    const items: SelectItem[] = sessionEntriesToSelectItems(
      entries,
      pickOptions?.currentId,
    );
    const list = new SelectList(items, Math.min(12, Math.max(5, items.length)), selectListTheme);
    return new Promise<string | null>((resolve) => {
      sessionPicker = {
        list,
        resolve,
        title: pickOptions?.title ?? 'Resume',
      };
      list.onSelect = (item) => {
        closeSessionPicker(item.value);
      };
      list.onCancel = () => {
        closeSessionPicker(null);
      };
      dispatch({ type: 'SET_STATUS', text: 'picking session' });
      applyLayout();
    });
  };

  const editor = new Editor(tui, editorTheme);
  if (typeof editor.setPaddingX === 'function') {
    editor.setPaddingX(1);
  }
  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(SLASH_MENU_COMMANDS, getProjectCwd()),
  );
  if (typeof editor.setAutocompleteMaxVisible === 'function') {
    editor.setAutocompleteMaxVisible(12);
  }

  let scrubbing = false;
  const scrubEditorText = () => {
    if (scrubbing) return;
    const current = editor.getText();
    const cleaned = scrubComposerBuffer(current);
    if (cleaned === current) return;
    scrubbing = true;
    try {
      editor.setText(cleaned);
    } finally {
      scrubbing = false;
    }
  };

  const inputGate = createInputGate();
  const editorHasAutocomplete = (): boolean =>
    Boolean((editor as unknown as { autocompleteState?: unknown }).autocompleteState);

  const applyScroll = (dir: 'up' | 'down') => {
    if (scrollView && typeof scrollView.scrollBy === 'function') {
      scrollView.scrollBy(dir === 'up' ? -3 : 3);
    }
    scrubEditorText();
    requestRender(true);
  };

  // Editor path: scrub + last-chance reject. CSI gating is in addInputListener.
  const rawHandleInput = editor.handleInput.bind(editor);
  editor.handleInput = (data: string) => {
    // Slash-autocomplete still needs up/down.
    if (
      editorHasAutocomplete()
      && (/^\x1b\[(?:\d+(?:;\d+)*)?[AB]$/.test(data) || /^\x1bO[AB]$/.test(data))
    ) {
      rawHandleInput(data);
      return;
    }

    const filtered = filterIncomingChunk(data);
    if (filtered.action === 'scroll' || filtered.action === 'consume' || filtered.action === 'escape') {
      scrubEditorText();
      return;
    }
    if (filtered.action === 'replace') {
      if (!filtered.data) {
        scrubEditorText();
        return;
      }
      rawHandleInput(filtered.data);
      scrubEditorText();
      return;
    }
    rawHandleInput(filtered.data);
    scrubEditorText();
  };

  editor.onChange = () => {
    scrubEditorText();
  };

  /** Ensure CSI junk cannot survive even one painted frame. */
  const composerEditor: Component = {
    invalidate() {
      editor.invalidate?.();
    },
    render(width: number) {
      scrubEditorText();
      return editor.render(width);
    },
    handleInput(data: string) {
      editor.handleInput(data);
    },
  };

  editor.onSubmit = (text) => {
    const value = scrubComposerBuffer(text).trim();
    editor.setText('');
    if (!value && !pendingPrompt) return;

    if (pendingPrompt) {
      const waiter = pendingPrompt;
      pendingPrompt = null;
      dispatch({ type: 'CLEAR_STATUS' });
      requestRender();
      waiter.resolve(value);
      return;
    }

    options.onSubmit(value);
  };

  let currentWide = isWide(getColumns());
  let scrollView: ScrollView | null = null;

  const buildComposerDock = (): Component => {
    if (sessionPicker) {
      return new VStack(
        [
          { component: resumePickerLabel, basis: 'auto' },
          { component: sessionPicker.list, basis: 'auto' },
          { component: statusBar, basis: 'auto' },
        ],
        { gap: 0 },
      );
    }
    return new VStack(
      [
        // Editor already draws its own top/bottom rules; label sits above that box.
        { component: composerLabel, basis: 'auto' },
        { component: composerEditor, basis: 'auto' },
        { component: statusBar, basis: 'auto' },
      ],
      { gap: 0 },
    );
  };

  const buildLayout = (wide: boolean): Component => {
    scrollView = new ScrollView(transcript, {
      follow: 'end',
      primary: true,
      scrollbar: 'auto',
      scrollbarStyle: theme.faint,
    });

    const dock = buildComposerDock();

    if (wide) {
      const railBasis = rightRailBasis(getColumns());
      const rightInner = new VStack(
        [
          { component: planPanel, grow: 1 },
          { component: sectionGap, basis: 'auto' },
          { component: agentsPanel, grow: 1 },
        ],
        { gap: 0 },
      );
      const right = new SidebarFrame(rightInner);
      const workbench = new HStack(
        [
          { component: scrollView, grow: 1, minSize: 40 },
          { component: right, basis: railBasis, minSize: 26 },
        ],
        { gap: 1 },
      );
      return new VStack(
        [
          { component: header, basis: 'auto' },
          { component: workbench, grow: 1 },
          { component: dock, basis: 'auto' },
        ],
        { gap: 0 },
      );
    }

    return new VStack(
      [
        { component: header, basis: 'auto' },
        { component: scrollView, grow: 1 },
        { component: compactOverlay, basis: 'auto', maxSize: 12 },
        { component: dock, basis: 'auto' },
      ],
      { gap: 0 },
    );
  };

  const applyLayout = () => {
    currentWide = isWide(getColumns());
    const root = buildLayout(currentWide);
    if (!isViewportTUI(tui)) {
      throw new Error('TuiAltScreen must be a ViewportTUI');
    }
    tui.setLayoutRoot(root);
    if (sessionPicker) {
      tui.setFocus(sessionPicker.list);
    } else {
      tui.setFocus(editor);
    }
    requestRender();
  };

  applyLayout();

  const onStdoutResize = () => {
    const wide = isWide(getColumns());
    if (wide !== currentWide) {
      if (wide) {
        dispatch({ type: 'SET_COMPACT_OVERLAY', overlay: 'none' });
      }
      applyLayout();
    } else {
      requestRender();
    }
  };
  process.stdout.on('resize', onStdoutResize);

  const removeInputListener = tui.addInputListener((data) => {
    // Timed-out lone ESC → abort (Escape key).
    if (inputGate.pollEscape()) {
      if (sessionPicker) {
        // Let SelectList cancel instead.
      } else {
        options.onAbort();
        scrubEditorText();
        requestRender(true);
        return { consume: true };
      }
    }

    const filtered = inputGate.feed(data);

    if (filtered.action === 'consume') {
      scrubEditorText();
      requestRender(true);
      return { consume: true };
    }

    if (filtered.action === 'scroll') {
      if (sessionPicker) {
        // Rebuild a full CSI so SelectList gets a real arrow, even if stdin split.
        return { data: filtered.dir === 'up' ? '\x1b[A' : '\x1b[B' };
      }
      if (editorHasAutocomplete()) {
        return { data: filtered.dir === 'up' ? '\x1b[A' : '\x1b[B' };
      }
      applyScroll(filtered.dir);
      return { consume: true };
    }

    if (filtered.action === 'escape') {
      if (sessionPicker) return undefined;
      options.onAbort();
      return { consume: true };
    }

    if (filtered.action === 'replace') {
      if (!filtered.data) {
        scrubEditorText();
        return { consume: true };
      }
      data = filtered.data;
    }

    const shortcut = classifyShellShortcut(data);
    if (shortcut === 'consume') {
      return { consume: true };
    }
    if (shortcut === 'exit') {
      if (sessionPicker) {
        closeSessionPicker(null);
        return { consume: true };
      }
      options.onExit();
      return { consume: true };
    }
    if (matchesKey(data, 'escape') || matchesKey(data, 'esc')) {
      if (sessionPicker) return undefined;
      options.onAbort();
      return { consume: true };
    }
    if (shortcut === 'cycle-overlay') {
      if (!isWide(getColumns())) {
        const next = cycleCompactOverlay(state.compactOverlay);
        dispatch({ type: 'SET_COMPACT_OVERLAY', overlay: next });
        requestRender();
      }
      return { consume: true };
    }
    if (filtered.action === 'replace') {
      return { data: filtered.data };
    }
    return undefined;
  });

  // Deliver delayed Escape from the input gate.
  const escapePoll = setInterval(() => {
    if (unmounted) return;
    if (!inputGate.pollEscape()) return;
    if (sessionPicker) return;
    options.onAbort();
    scrubEditorText();
    requestRender(true);
  }, 25);

  setTuiMode(true);
  // Clear any mouse tracking left on by a prior session / crashed TUI.
  try {
    terminal.write(DISABLE_MOUSE_TRACKING);
  } catch {
    // ignore
  }
  tui.start();
  try {
    terminal.write(DISABLE_MOUSE_TRACKING);
  } catch {
    // ignore
  }

  const unmount = () => {
    if (unmounted) return;
    unmounted = true;
    clearInterval(escapePoll);
    inputGate.reset();
    process.stdout.off('resize', onStdoutResize);
    removeInputListener();
    if (sessionPicker) {
      const closer = sessionPicker;
      sessionPicker = null;
      closer.resolve(null);
    }
    if (pendingPrompt) {
      pendingPrompt.resolve('');
      pendingPrompt = null;
    }
    try {
      terminal.write(DISABLE_MOUSE_TRACKING);
      tui.stop();
    } catch {
      // ignore
    }
    setTuiMode(false);
    exitResolve?.();
  };

  return {
    bridge,
    waitForExit: () => exitPromise,
    unmount,
    getState,
    pickSession,
    setPlanSteps(steps) {
      dispatch({ type: 'SET_PLAN_STEPS', steps });
      requestRender();
    },
    setAgents(agents) {
      dispatch({ type: 'SET_AGENTS', agents });
      requestRender();
    },
    setPendingCount(count) {
      dispatch({ type: 'SET_PENDING_COUNT', count });
      requestRender();
    },
    setCompactOverlay(overlay) {
      dispatch({ type: 'SET_COMPACT_OVERLAY', overlay });
      requestRender();
    },
    setMemorySnapshot(text) {
      dispatch({ type: 'SET_MEMORY_SNAPSHOT', text });
      requestRender();
    },
    clearTranscript() {
      dispatch({ type: 'CLEAR_TRANSCRIPT' });
      requestRender();
    },
    loadTranscript(messages) {
      dispatch({ type: 'LOAD_TRANSCRIPT', messages });
      requestRender();
    },
  };
}
