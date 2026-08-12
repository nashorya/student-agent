import {
  Editor,
  HStack,
  matchesKey,
  ProcessTerminal,
  ScrollView,
  TuiAltScreen,
  VStack,
  isViewportTUI,
  type Component,
} from '@earendil-works/pi-tui';
import { setTuiMode } from '../runtime/logger.js';
import type { UiBridge } from '../runtime/ui-bridge.js';
import { createShellBridge, type ShellUiBridge } from './bridge.js';
import {
  AgentsPanel,
  CompactOverlayPanel,
  PlanPanel,
  StatusBar,
  TranscriptView,
} from './components.js';
import { isWide, rightRailBasis } from './layout.js';
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
}

export interface ShellHandle {
  bridge: UiBridge;
  waitForExit: () => Promise<void>;
  unmount: () => void;
  setPlanSteps: (steps: ShellPlanStep[]) => void;
  setAgents: (agents: ShellAgentRow[]) => void;
  setPendingCount: (count: number) => void;
  setCompactOverlay: (overlay: CompactOverlay) => void;
  clearTranscript: () => void;
  getState: () => ShellState;
}

/**
 * promptSettings Phase 1 UX:
 * Put the question in the transcript and reuse the bottom Composer.
 * A centered Editor overlay looked like the input "drifted" into the model list.
 */
export function startShell(options: StartShellOptions): ShellHandle {
  let state = initialShellState();
  const getState = () => state;

  const terminal = new ProcessTerminal();
  const tui = new TuiAltScreen(terminal, true, undefined, { mouse: true });

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
  };

  /** When set, the next Composer submit answers promptSettings (no overlay). */
  let pendingPrompt: { resolve: (answer: string) => void } | null = null;

  const promptSettings = async (question: string): Promise<string> => {
    if (pendingPrompt) {
      pendingPrompt.resolve('');
      pendingPrompt = null;
    }

    dispatch({
      type: 'ADD_MESSAGE',
      kind: 'system',
      content: question.trim() || '(input required)',
    });
    dispatch({ type: 'SET_STATUS', text: 'awaiting input in composer…' });
    requestRender(true);
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

  const transcript = new TranscriptView(getState);
  const planPanel = new PlanPanel(getState);
  const agentsPanel = new AgentsPanel(getState);
  const compactOverlay = new CompactOverlayPanel(getState);
  const statusBar = new StatusBar(getState, getMeta, getColumns);

  const editor = new Editor(tui, editorTheme);
  editor.onSubmit = (text) => {
    const value = text.trim();
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

  const buildLayout = (wide: boolean): Component => {
    scrollView = new ScrollView(transcript, {
      follow: 'end',
      primary: true,
      scrollbar: 'auto',
      scrollbarStyle: theme.muted,
    });

    const dock = new VStack(
      [
        { component: editor, basis: 'auto' },
        { component: statusBar, basis: 'auto' },
      ],
      { gap: 0 },
    );

    if (wide) {
      const railBasis = rightRailBasis(getColumns());
      const right = new VStack(
        [
          { component: planPanel, grow: 1 },
          { component: agentsPanel, grow: 1 },
        ],
        { gap: 1 },
      );
      return new VStack(
        [
          {
            component: new HStack(
              [
                { component: scrollView, grow: 1, minSize: 40 },
                { component: right, basis: railBasis, minSize: 24 },
              ],
              { gap: 1 },
            ),
            grow: 1,
          },
          { component: dock, basis: 'auto' },
        ],
        { gap: 0 },
      );
    }

    // Compact: transcript + optional Plan/Agents overlay + composer/status
    return new VStack(
      [
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
    tui.setFocus(editor);
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

  /**
   * Global keys:
   * - ctrl+c → onExit
   * - escape → onAbort
   * - ctrl+p → cycle compact Plan/Agents overlay (narrow only)
   */
  const removeInputListener = tui.addInputListener((data) => {
    if (matchesKey(data, 'ctrl+c')) {
      options.onExit();
      return { consume: true };
    }
    if (matchesKey(data, 'escape') || matchesKey(data, 'esc')) {
      options.onAbort();
      return { consume: true };
    }
    if (matchesKey(data, 'ctrl+p')) {
      if (!isWide(getColumns())) {
        const next: CompactOverlay =
          state.compactOverlay === 'none' ? 'plan' :
          state.compactOverlay === 'plan' ? 'agents' :
          'none';
        dispatch({ type: 'SET_COMPACT_OVERLAY', overlay: next });
        requestRender();
      }
      return { consume: true };
    }
    return undefined;
  });

  setTuiMode(true);
  tui.start();

  const unmount = () => {
    if (unmounted) return;
    unmounted = true;
    process.stdout.off('resize', onStdoutResize);
    removeInputListener();
    if (pendingPrompt) {
      pendingPrompt.resolve('');
      pendingPrompt = null;
    }
    try {
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
    clearTranscript() {
      dispatch({ type: 'CLEAR_TRANSCRIPT' });
      requestRender();
    },
  };
}
