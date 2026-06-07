import { matchesKey } from '@earendil-works/pi-tui';
import type { TUIV2Action } from './events.js';
import type { TUIV2State } from './state.js';
import { getCompletions, clampCompletionIndex } from './components/completions.js';

const SHORTCUTS_HELP = `**快捷键**
  Enter          发送消息
  Tab            自动补全命令
  ↑ / ↓          历史记录 / 补全导航
  Shift+↑/↓      向上/向下翻页
  Esc            清空输入 / 取消提示
  Ctrl+C         中止当前任务 / 退出

**复制文本**
  TUI 已启用鼠标滚轮，选中文字需按住修饰键再拖拽：
  · iTerm2 / Warp：Option + 拖拽
  · Terminal.app / Windows Terminal：Shift + 拖拽

**常用命令**
  /task status      查看当前任务状态
  /task cancel      取消当前任务
  /plan             查看/修订执行计划
  /review up        验收当前任务结果
  /review down [原因]  拒绝并要求修订
  /feedback [内容]  发送质量反馈
  /why              解释上一步的决策
  /quit             退出`;


const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';

export interface InputController {
  handleData: (chunk: string) => void;
  handleKey: (key: string) => void;
  prompt: (question: string) => Promise<string>;
}

export function createInputController(options: {
  getState: () => TUIV2State;
  dispatch: (action: TUIV2Action) => void;
  onSubmit: (value: string) => void;
  onAbort: () => void;
  onExit?: () => void;
}): InputController {
  let pasteBuffer: string | null = null;
  let promptResolve: ((answer: string) => void) | null = null;

  const resolvePrompt = (answer: string) => {
    const resolve = promptResolve;
    promptResolve = null;
    options.dispatch({ type: 'END_PROMPT' });
    resolve?.(answer);
  };

  const submitDraft = () => {
    const value = options.getState().input.value;
    if (options.getState().input.promptQuestion !== null) {
      resolvePrompt(value);
      return;
    }
    if (value.trim()) {
      options.onSubmit(value);
      options.dispatch({ type: 'ADD_TO_HISTORY', value });
    }
    options.dispatch({ type: 'CLEAR_INPUT' });
  };

  const handleEscape = () => {
    const state = options.getState();
    if (state.input.promptQuestion !== null) {
      resolvePrompt('');
      return;
    }
    // If completions are open, close them without clearing input
    if (state.input.completionIndex >= 0) {
      options.dispatch({ type: 'COMPLETION_RESET' });
      return;
    }
    if (state.input.value) {
      options.dispatch({ type: 'CLEAR_INPUT' });
      return;
    }
    options.onAbort();
  };

  const handleInterrupt = () => {
    const state = options.getState();
    if (state.input.promptQuestion !== null) {
      resolvePrompt('');
      return;
    }
    if (state.input.value) {
      options.dispatch({ type: 'CLEAR_INPUT' });
      return;
    }
    if (state.streaming || state.status.currentTool !== null) {
      options.onAbort();
      return;
    }
    (options.onExit ?? options.onAbort)();
  };

  // Apply the currently-selected (or first) completion item
  const applyCompletion = (): boolean => {
    const state = options.getState();
    const items = getCompletions(state.input.value);
    if (items.length === 0) return false;
    const idx = state.input.completionIndex >= 0
      ? clampCompletionIndex(items, state.input.completionIndex)
      : 0;
    const completion = items[idx]!;
    options.dispatch({
      type: 'SET_INPUT',
      value: completion,
      cursor: Array.from(completion).length,
    });
    return true;
  };

  const handleData = (chunk: string) => {
    let rest = chunk;
    while (rest.length > 0) {
      if (pasteBuffer !== null) {
        const endIndex = rest.indexOf(BRACKETED_PASTE_END);
        if (endIndex < 0) {
          pasteBuffer += rest;
          return;
        }
        pasteBuffer += rest.slice(0, endIndex);
        insertText(pasteBuffer);
        pasteBuffer = null;
        rest = rest.slice(endIndex + BRACKETED_PASTE_END.length);
        continue;
      }

      if (rest.startsWith(BRACKETED_PASTE_START)) {
        pasteBuffer = '';
        rest = rest.slice(BRACKETED_PASTE_START.length);
        continue;
      }
      const sequence = readEscapeSequence(rest);
      if (sequence !== null) {
        handleEscapeSequence(sequence);
        rest = rest.slice(sequence.length);
        continue;
      }

      const [key] = Array.from(rest);
      if (key === undefined) return;
      handleKey(key);
      rest = rest.slice(key.length);
    }
  };

  const handleKey = (key: string) => {
    if (key === '') {
      handleInterrupt();
      return;
    }
    if (key === '\x1b') {
      handleEscape();
      return;
    }
    if (key === '\t') {
      applyCompletion();
      return;
    }
    if (key === '\r' || key === '\n') {
      submitDraft();
      return;
    }
    if (key === '\x7f' || key === '\b') {
      deleteBeforeCursor();
      return;
    }
    // '?' with empty input → show shortcuts help in transcript
    if (key === '?' && options.getState().input.value === '' && options.getState().input.promptQuestion === null) {
      options.dispatch({
        type: 'APPEND_MESSAGE',
        role: 'system',
        content: SHORTCUTS_HELP,
      });
      return;
    }
    if (!/[\x00-\x1F\x7F]/u.test(key)) {
      insertText(key);
    }
  };

  return {
    handleData,
    handleKey,
    prompt(question) {
      if (promptResolve) resolvePrompt('');
      options.dispatch({ type: 'BEGIN_PROMPT', question });
      return new Promise((resolve) => {
        promptResolve = resolve;
      });
    },
  };

  function insertText(text: string): void {
    if (!text) return;
    const state = options.getState();
    const { before, after } = splitAtCursor(state.input.value, state.input.cursor);
    const value = before + text + after;
    options.dispatch({
      type: 'SET_INPUT',
      value,
      cursor: state.input.cursor + Array.from(text).length,
    });
  }

  function deleteBeforeCursor(): void {
    const state = options.getState();
    if (state.input.cursor <= 0) return;
    const chars = Array.from(state.input.value);
    chars.splice(state.input.cursor - 1, 1);
    options.dispatch({
      type: 'SET_INPUT',
      value: chars.join(''),
      cursor: state.input.cursor - 1,
    });
  }

  function handleEscapeSequence(sequence: string): void {
    // Mouse wheel: SGR mode \x1b[<64;x;yM = scroll up, \x1b[<65;x;yM = scroll down
    const mouseMatch = sequence.match(/^\x1b\[<(\d+);\d+;\d+[Mm]$/);
    if (mouseMatch) {
      const btn = parseInt(mouseMatch[1]!, 10);
      if (btn === 64) { options.dispatch({ type: 'SCROLL', delta: 3 }); return; }
      if (btn === 65) { options.dispatch({ type: 'SCROLL', delta: -3 }); return; }
      return; // ignore other mouse events
    }

    if (matchesKey(sequence, 'ctrl+c')) {
      handleInterrupt();
      return;
    }
    if (matchesKey(sequence, 'escape')) {
      handleEscape();
      return;
    }
    if (matchesKey(sequence, 'enter') || matchesKey(sequence, 'return')) {
      submitDraft();
      return;
    }
    if (matchesKey(sequence, 'backspace')) {
      deleteBeforeCursor();
      return;
    }
    if (matchesKey(sequence, 'left')) {
      options.dispatch({ type: 'MOVE_CURSOR', direction: 'left' });
      return;
    }
    if (matchesKey(sequence, 'right')) {
      options.dispatch({ type: 'MOVE_CURSOR', direction: 'right' });
      return;
    }
    if (matchesKey(sequence, 'shift+up') || matchesKey(sequence, 'pageUp')) {
      options.dispatch({ type: 'SCROLL', delta: 5 });
      return;
    }
    if (matchesKey(sequence, 'shift+down') || matchesKey(sequence, 'pageDown')) {
      options.dispatch({ type: 'SCROLL', delta: -5 });
      return;
    }
    if (matchesKey(sequence, 'up')) {
      // Navigate completions if visible, else history
      const state = options.getState();
      if (getCompletions(state.input.value).length > 0) {
        options.dispatch({ type: 'COMPLETION_NAVIGATE', direction: 'up' });
      } else {
        options.dispatch({ type: 'NAVIGATE_HISTORY', direction: 'up' });
      }
      return;
    }
    if (matchesKey(sequence, 'down')) {
      // Navigate completions if visible, else history
      const state = options.getState();
      if (getCompletions(state.input.value).length > 0) {
        options.dispatch({ type: 'COMPLETION_NAVIGATE', direction: 'down' });
      } else {
        options.dispatch({ type: 'NAVIGATE_HISTORY', direction: 'down' });
      }
    }
  }
}

function splitAtCursor(value: string, cursor: number): { before: string; after: string } {
  const chars = Array.from(value);
  return {
    before: chars.slice(0, cursor).join(''),
    after: chars.slice(cursor).join(''),
  };
}

function readEscapeSequence(input: string): string | null {
  if (!input.startsWith('\x1b')) return null;
  if (input.length === 1) return input;
  if (input.startsWith('\x1b[') || input.startsWith('\x1bO')) {
    for (let index = 2; index < input.length; index += 1) {
      const code = input.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) return input.slice(0, index + 1);
    }
    return input;
  }
  return input.slice(0, 2);
}
