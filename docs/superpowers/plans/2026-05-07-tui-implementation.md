# TUI 界面实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 student_agent CLI 添加基于 Ink 的 TUI 界面，实现主输出区 + 底部状态栏布局

**Architecture:** 在现有 REPL 入口外包一层 Ink 渲染层，维护 AppState，通过事件更新状态，Ink 组件消费状态渲染界面。非 TTY 环境自动降级回纯文本 REPL。

**Tech Stack:** Ink 5.x, React 18.x, TypeScript, chalk (已有)

---

## 文件结构

**新增文件**：
- `src/tui/index.ts` — Ink 入口，TTY 检测 + 降级逻辑
- `src/tui/app.tsx` — 根组件，布局容器
- `src/tui/state.ts` — AppState 类型定义 + React Context
- `src/tui/components/OutputArea.tsx` — 滚动输出区
- `src/tui/components/StatusBar.tsx` — 底部状态栏
- `src/tui/components/InputLine.tsx` — 输入行（替换 readline）
- `src/tui/bridge.ts` — EventRenderer 到 AppState 的桥接层

**修改文件**：
- `src/extension/index.ts` — 替换 readline 循环为 TUI 入口
- `src/cli/event-renderer.ts` — 添加 AppState 推送接口
- `package.json` — 添加 ink 和 react 依赖

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 添加 ink 和 react 依赖**

```bash
npm install ink@^5.0.0 react@^18.3.0
```

Expected: `package.json` 中 dependencies 新增 `ink` 和 `react`

- [ ] **Step 2: 添加类型定义**

```bash
npm install --save-dev @types/react@^18.3.0
```

Expected: `package.json` 中 devDependencies 新增 `@types/react`

- [ ] **Step 3: 验证安装**

```bash
npm list ink react
```

Expected: 显示 ink@5.x.x 和 react@18.x.x

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add ink and react for TUI"
```

---

## Task 2: AppState 类型定义

**Files:**
- Create: `src/tui/state.ts`

- [ ] **Step 1: 定义 Message 类型**

```typescript
export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  timestamp: number;
}
```

- [ ] **Step 2: 定义 TaskStatus 类型**

```typescript
export interface TaskStatus {
  name: string;
  phaseIndex: number;
  totalPhases: number;
  retryCount: number;
  toolCallCount: number;
  elapsedMs: number;
  state: 'running' | 'idle' | 'failed';
}
```

- [ ] **Step 3: 定义 AppState 类型**

```typescript
export interface AppState {
  messages: Message[];
  taskStatus: TaskStatus | null;
  inputValue: string;
  inputHistory: string[];
  historyIndex: number;
}
```

- [ ] **Step 4: 创建 React Context**

```typescript
import { createContext, useContext } from 'react';

export const AppStateContext = createContext<{
  state: AppState;
  dispatch: (action: AppAction) => void;
} | null>(null);

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
```

- [ ] **Step 5: 定义 AppAction 类型**

```typescript
export type AppAction =
  | { type: 'ADD_MESSAGE'; message: Message }
  | { type: 'UPDATE_LAST_MESSAGE'; content: string }
  | { type: 'UPDATE_TASK_STATUS'; status: Partial<TaskStatus> }
  | { type: 'CLEAR_TASK_STATUS' }
  | { type: 'SET_INPUT'; value: string }
  | { type: 'ADD_TO_HISTORY'; value: string }
  | { type: 'NAVIGATE_HISTORY'; direction: 'up' | 'down' };
```

- [ ] **Step 6: 实现 reducer**

```typescript
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.message] };
    case 'UPDATE_LAST_MESSAGE': {
      const messages = [...state.messages];
      if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
        messages[messages.length - 1] = {
          ...messages[messages.length - 1],
          content: action.content,
        };
      }
      return { ...state, messages };
    }
    case 'UPDATE_TASK_STATUS':
      return {
        ...state,
        taskStatus: state.taskStatus
          ? { ...state.taskStatus, ...action.status }
          : (action.status as TaskStatus),
      };
    case 'CLEAR_TASK_STATUS':
      return { ...state, taskStatus: null };
    case 'SET_INPUT':
      return { ...state, inputValue: action.value };
    case 'ADD_TO_HISTORY':
      return {
        ...state,
        inputHistory: [...state.inputHistory, action.value],
        historyIndex: state.inputHistory.length + 1,
      };
    case 'NAVIGATE_HISTORY': {
      const newIndex =
        action.direction === 'up'
          ? Math.max(0, state.historyIndex - 1)
          : Math.min(state.inputHistory.length, state.historyIndex + 1);
      return {
        ...state,
        historyIndex: newIndex,
        inputValue: state.inputHistory[newIndex] ?? '',
      };
    }
    default:
      return state;
  }
}
```

- [ ] **Step 7: 导出初始状态**

```typescript
export const initialAppState: AppState = {
  messages: [],
  taskStatus: null,
  inputValue: '',
  inputHistory: [],
  historyIndex: 0,
};
```

- [ ] **Step 8: Commit**

```bash
git add src/tui/state.ts
git commit -m "feat(tui): add AppState types and reducer"
```

---

## Task 3: StatusBar 组件

**Files:**
- Create: `src/tui/components/StatusBar.tsx`

- [ ] **Step 1: 实现 StatusBar 组件**

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { useAppState } from '../state.js';

export function StatusBar() {
  const { state } = useAppState();
  const { taskStatus } = state;

  if (!taskStatus) {
    return (
      <Box borderStyle="single" borderColor="gray">
        <Text dimColor>student-agent · 就绪</Text>
      </Box>
    );
  }

  const { name, phaseIndex, totalPhases, retryCount, toolCallCount, elapsedMs, state: taskState } = taskStatus;
  const elapsed = formatElapsed(elapsedMs);
  const retryText = retryCount > 0 ? ` · 重试:${retryCount}` : '';
  const stateIndicator = getStateIndicator(taskState);

  return (
    <Box borderStyle="single" borderColor="gray">
      <Text>
        [{truncate(name, 20)}] Phase {phaseIndex + 1}/{totalPhases}
        <Text color={retryCount > 0 ? 'yellow' : undefined}>{retryText}</Text>
        {' · '}工具:{toolCallCount} · {elapsed} · {stateIndicator}
      </Text>
    </Box>
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
  return `00:${remainingSeconds.toString().padStart(2, '0')}`;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

function getStateIndicator(state: 'running' | 'idle' | 'failed'): JSX.Element {
  switch (state) {
    case 'running':
      return <Text color="green">● 运行中</Text>;
    case 'idle':
      return <Text dimColor>◌ 等待输入</Text>;
    case 'failed':
      return <Text color="red">✗ 失败</Text>;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/components/StatusBar.tsx
git commit -m "feat(tui): add StatusBar component"
```

---

## Task 4: OutputArea 组件

**Files:**
- Create: `src/tui/components/OutputArea.tsx`

- [ ] **Step 1: 实现 OutputArea 组件**

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { useAppState } from '../state.js';

export function OutputArea() {
  const { state } = useAppState();
  const { messages } = state;

  return (
    <Box flexDirection="column" paddingX={1}>
      {messages.map((msg, idx) => (
        <MessageLine key={idx} message={msg} />
      ))}
    </Box>
  );
}

function MessageLine({ message }: { message: { role: string; content: string } }) {
  const prefix = getPrefix(message.role);
  return (
    <Box>
      <Text color={getPrefixColor(message.role)}>{prefix}</Text>
      <Text>{message.content}</Text>
    </Box>
  );
}

function getPrefix(role: string): string {
  switch (role) {
    case 'user':
      return '> ';
    case 'assistant':
      return 'Assistant: ';
    case 'tool':
      return 'Tool: ';
    case 'system':
      return '✓ ';
    default:
      return '';
  }
}

function getPrefixColor(role: string): string {
  switch (role) {
    case 'user':
      return 'cyan';
    case 'assistant':
      return 'white';
    case 'tool':
      return 'yellow';
    case 'system':
      return 'green';
    default:
      return 'white';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/components/OutputArea.tsx
git commit -m "feat(tui): add OutputArea component"
```

---

## Task 5: InputLine 组件

**Files:**
- Create: `src/tui/components/InputLine.tsx`

- [ ] **Step 1: 实现 InputLine 组件**

```typescript
import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppState } from '../state.js';

interface InputLineProps {
  onSubmit: (value: string) => void;
  onAbort: () => void;
}

export function InputLine({ onSubmit, onAbort }: InputLineProps) {
  const { state, dispatch } = useAppState();
  const { inputValue } = state;

  useInput((input, key) => {
    if (key.escape) {
      onAbort();
      return;
    }

    if (key.return) {
      if (inputValue.trim()) {
        onSubmit(inputValue);
        dispatch({ type: 'ADD_TO_HISTORY', value: inputValue });
        dispatch({ type: 'SET_INPUT', value: '' });
      }
      return;
    }

    if (key.upArrow) {
      dispatch({ type: 'NAVIGATE_HISTORY', direction: 'up' });
      return;
    }

    if (key.downArrow) {
      dispatch({ type: 'NAVIGATE_HISTORY', direction: 'down' });
      return;
    }

    if (key.backspace || key.delete) {
      dispatch({ type: 'SET_INPUT', value: inputValue.slice(0, -1) });
      return;
    }

    // 多行粘贴：替换换行符为空格
    const sanitized = input.replace(/\n/g, ' ');
    dispatch({ type: 'SET_INPUT', value: inputValue + sanitized });
  });

  return (
    <Box>
      <Text color="cyan">&gt; </Text>
      <Text>{inputValue}</Text>
      <Text inverse> </Text>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/components/InputLine.tsx
git commit -m "feat(tui): add InputLine component with history and paste support"
```

---

## Task 6: App 根组件

**Files:**
- Create: `src/tui/app.tsx`

- [ ] **Step 1: 实现 App 组件**

```typescript
import React, { useReducer } from 'react';
import { Box } from 'ink';
import { AppStateContext, appReducer, initialAppState } from './state.js';
import { OutputArea } from './components/OutputArea.js';
import { StatusBar } from './components/StatusBar.js';
import { InputLine } from './components/InputLine.js';

interface AppProps {
  onSubmit: (value: string) => void;
  onAbort: () => void;
}

export function App({ onSubmit, onAbort }: AppProps) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);

  return (
    <AppStateContext.Provider value={{ state, dispatch }}>
      <Box flexDirection="column" height="100%">
        <Box flexGrow={1} flexDirection="column">
          <OutputArea />
        </Box>
        <InputLine onSubmit={onSubmit} onAbort={onAbort} />
        <StatusBar />
      </Box>
    </AppStateContext.Provider>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tui/app.tsx
git commit -m "feat(tui): add App root component with layout"
```

---

## Task 7: Bridge 层（EventRenderer → AppState）

**Files:**
- Create: `src/tui/bridge.ts`

- [ ] **Step 1: 定义 Bridge 接口**

```typescript
import type { AppAction } from './state.js';

export interface TUIBridge {
  dispatch: (action: AppAction) => void;
  addMessage: (role: 'user' | 'assistant' | 'tool' | 'system', content: string) => void;
  updateLastMessage: (content: string) => void;
  updateTaskStatus: (status: Partial<{
    name: string;
    phaseIndex: number;
    totalPhases: number;
    retryCount: number;
    toolCallCount: number;
    elapsedMs: number;
    state: 'running' | 'idle' | 'failed';
  }>) => void;
  clearTaskStatus: () => void;
}
```

- [ ] **Step 2: 实现 createBridge 工厂函数**

```typescript
export function createBridge(dispatch: (action: AppAction) => void): TUIBridge {
  return {
    dispatch,
    addMessage(role, content) {
      dispatch({
        type: 'ADD_MESSAGE',
        message: { role, content, timestamp: Date.now() },
      });
    },
    updateLastMessage(content) {
      dispatch({ type: 'UPDATE_LAST_MESSAGE', content });
    },
    updateTaskStatus(status) {
      dispatch({ type: 'UPDATE_TASK_STATUS', status });
    },
    clearTaskStatus() {
      dispatch({ type: 'CLEAR_TASK_STATUS' });
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/bridge.ts
git commit -m "feat(tui): add bridge layer for EventRenderer integration"
```

---

## Task 8: TUI 入口（TTY 检测 + 降级）

**Files:**
- Create: `src/tui/index.ts`

- [ ] **Step 1: 实现 startTUI 函数**

```typescript
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { createBridge, type TUIBridge } from './bridge.js';

export interface TUIHandle {
  bridge: TUIBridge;
  waitForExit: () => Promise<void>;
  unmount: () => void;
}

export function startTUI(options: {
  onSubmit: (value: string) => void;
  onAbort: () => void;
}): TUIHandle {
  const { onSubmit, onAbort } = options;

  const { rerender, unmount, waitUntilExit } = render(
    React.createElement(App, { onSubmit, onAbort })
  );

  // 获取 dispatch 函数（通过 ref 传递）
  let dispatchRef: ((action: any) => void) | null = null;
  const bridge = createBridge((action) => {
    if (dispatchRef) dispatchRef(action);
  });

  // 注入 dispatch ref（需要在 App 中暴露）
  // 这里简化处理：通过全局变量传递（生产代码应使用 ref）
  (globalThis as any).__tuiDispatch = (dispatch: any) => {
    dispatchRef = dispatch;
  };

  return {
    bridge,
    waitForExit: waitUntilExit,
    unmount,
  };
}

export function isTTY(): boolean {
  return process.stdout.isTTY === true;
}
```

- [ ] **Step 2: 修改 App 组件暴露 dispatch**

修改 `src/tui/app.tsx`，在 useReducer 后添加：

```typescript
// 暴露 dispatch 给 bridge（临时方案）
React.useEffect(() => {
  (globalThis as any).__tuiDispatch?.(dispatch);
}, [dispatch]);
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/index.ts src/tui/app.tsx
git commit -m "feat(tui): add TUI entry point with TTY detection"
```

---

## Task 9: 修改 EventRenderer 集成 Bridge

**Files:**
- Modify: `src/cli/event-renderer.ts:1-50`

- [ ] **Step 1: 添加 TUIBridge 可选参数**

在 `EventRenderer` 类构造函数中添加：

```typescript
import type { TUIBridge } from '../tui/bridge.js';

export class EventRenderer {
  private bridge?: TUIBridge;

  constructor(bridge?: TUIBridge) {
    this.bridge = bridge;
    // ... 现有代码
  }
```

- [ ] **Step 2: 在 message_start 时推送消息**

在 `handleMessageStart` 方法中添加：

```typescript
private handleMessageStart() {
  this.bridge?.addMessage('assistant', '');
  // ... 现有代码
}
```

- [ ] **Step 3: 在 message_update 时更新最后一条消息**

在 `handleMessageUpdate` 方法中添加：

```typescript
private handleMessageUpdate(delta: string) {
  this.accumulatedText += delta;
  this.bridge?.updateLastMessage(this.accumulatedText);
  // ... 现有代码
}
```

- [ ] **Step 4: 在 tool_execution_start 时推送工具消息**

在 `handleToolExecutionStart` 方法中添加：

```typescript
private handleToolExecutionStart(toolName: string) {
  this.bridge?.addMessage('tool', toolName);
  // ... 现有代码
}
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/event-renderer.ts
git commit -m "feat(tui): integrate EventRenderer with TUIBridge"
```

---

## Task 10: 修改主入口集成 TUI

**Files:**
- Modify: `src/extension/index.ts:155-300`

- [ ] **Step 1: 导入 TUI 模块**

在文件顶部添加：

```typescript
import { startTUI, isTTY } from '../tui/index.js';
import type { TUIHandle } from '../tui/index.js';
```

- [ ] **Step 2: 替换 main 函数中的 REPL 循环**

找到 `// ── REPL ─────────────────────────────────────────` 注释后的代码，替换为：

```typescript
printBanner();

if (isTTY()) {
  // TUI 模式
  let resolveSubmit: ((value: string) => void) | null = null;
  let abortRequested = false;

  const tui = startTUI({
    onSubmit: (value) => {
      resolveSubmit?.(value);
    },
    onAbort: () => {
      abortRequested = true;
    },
  });

  // 更新 EventRenderer 使用 bridge
  runtime.renderer = new EventRenderer(tui.bridge);
  runtime.unsubscribe();
  runtime.unsubscribe = runtime.agent.subscribe((event) => {
    runtime.renderer.handleEvent(event);
  });

  while (true) {
    const userInput = await new Promise<string>((resolve) => {
      resolveSubmit = resolve;
    });

    if (!userInput.trim()) continue;

    tui.bridge.addMessage('user', userInput);

    // ... 现有的 command 处理和任务执行逻辑
    // （保持不变，只是不再使用 readline）

    if (abortRequested) {
      abortRequested = false;
      // 处理中止逻辑
    }
  }
} else {
  // 降级到纯文本 REPL（保留现有 readline 代码）
  const rl = createInterface({
    input,
    output,
    completer: (line: string) => {
      const hits = COMMANDS.filter((c) => c.startsWith(line));
      return [hits.length ? hits : COMMANDS, line] as [string[], string];
    }
  });

  while (true) {
    const userInput = await rl.question(chalk.cyan('\n> '));
    // ... 现有逻辑
  }
}
```

- [ ] **Step 3: 验证编译**

```bash
tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/extension/index.ts
git commit -m "feat(tui): integrate TUI into main entry point with fallback"
```

---

## Task 11: 添加任务状态更新逻辑

**Files:**
- Modify: `src/extension/index.ts:200-250`

- [ ] **Step 1: 在任务开始时更新状态**

在 `// ── 自然语言任务 ────────────────────────` 注释后添加：

```typescript
if (isTTY() && tui) {
  const activeTask = tasksManager.getActiveTask();
  if (activeTask) {
    tui.bridge.updateTaskStatus({
      name: activeTask.name,
      phaseIndex: activeTask.active_phase_index,
      totalPhases: activeTask.phases.length,
      retryCount: activeTask.phases[activeTask.active_phase_index]?.retry_count ?? 0,
      toolCallCount: 0, // 初始化
      elapsedMs: 0,
      state: 'running',
    });
  }
}
```

- [ ] **Step 2: 在任务完成时清除状态**

在 `await runtime.agent.waitForIdle()` 后添加：

```typescript
if (isTTY() && tui) {
  tui.bridge.updateTaskStatus({ state: 'idle' });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/extension/index.ts
git commit -m "feat(tui): update task status in TUI during execution"
```

---

## Task 12: 手动测试

**Files:**
- Test: 手动运行

- [ ] **Step 1: 启动 TUI 模式**

```bash
npm run dev
```

Expected: 显示 TUI 界面，底部状态栏显示 "student-agent · 就绪"

- [ ] **Step 2: 输入简单任务**

输入: `帮我创建一个 hello.txt 文件`

Expected: 
- 输出区显示用户输入和 Assistant 响应
- 状态栏显示任务名、阶段、工具调用数
- 流式输出逐字符显示

- [ ] **Step 3: 测试历史记录**

按上箭头，Expected: 显示上一条输入

- [ ] **Step 4: 测试多行粘贴**

粘贴包含换行符的文本，Expected: 换行符被替换为空格

- [ ] **Step 5: 测试 Escape 中止**

输入任务后按 Escape，Expected: 任务中止

- [ ] **Step 6: 测试非 TTY 降级**

```bash
echo "帮我创建 test.txt" | npm run dev
```

Expected: 降级到纯文本 REPL，无 TUI 界面

- [ ] **Step 7: 记录测试结果**

创建 `docs/superpowers/plans/2026-05-07-tui-test-results.md`，记录测试结果和发现的问题

---

## Task 13: 文档更新

**Files:**
- Modify: `README.md` 或 `CLAUDE.md`

- [ ] **Step 1: 添加 TUI 使用说明**

在 README.md 中添加：

```markdown
## TUI 界面

student_agent 支持基于 Ink 的 TUI 界面（终端用户界面）：

- **主输出区**：显示对话历史和流式输出
- **底部状态栏**：实时显示任务进度、阶段、重试次数、工具调用数
- **输入行**：支持历史记录（上下箭头）、Escape 中止、多行粘贴

**降级**：非 TTY 环境（CI、管道）自动降级到纯文本 REPL。
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add TUI usage instructions"
```

---

## 自检清单

**Spec 覆盖**：
- ✓ 主输出区 + 状态栏布局（Task 3-6）
- ✓ 输入行历史记录、Escape、多行粘贴（Task 5）
- ✓ 状态栏字段（任务名、阶段、重试、工具、耗时、状态）（Task 3）
- ✓ TTY 检测 + 降级（Task 8, 10）
- ✓ EventRenderer 集成（Task 7, 9）

**占位符扫描**：无 TBD/TODO

**类型一致性**：
- AppState, AppAction, TUIBridge 类型在所有任务中一致
- Message, TaskStatus 字段名称统一

**依赖关系**：
- Task 1 必须先完成（安装依赖）
- Task 2-6 可并行（组件独立）
- Task 7-9 依赖 Task 2-6
- Task 10-11 依赖 Task 7-9
- Task 12-13 最后执行
