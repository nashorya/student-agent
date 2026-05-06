# Task Phase Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 agent 自动识别用户意图并创建任务/Phase，通过结构化信号管理 Phase 生命周期，在同一 Phase 连续三次负反馈后自动查询 Context7 文档辅助重做。

**Architecture:** REPL 主循环在发送给 Pi agent 之前先做意图分类（新任务/负反馈/继续）；agent 的 system prompt 里有固定的输出格式约定（`[TASK_START]` / `[PHASE_DONE]`），REPL 解析这些信号驱动 Phase UI；`tasks.json` 持久化 Phase 重试计数，第三次负反馈时用 Pi 的 `completeSimple` 总结问题关键词后查 Context7，把文档塞进下一轮消息。

**Tech Stack:** TypeScript, `@mariozechner/pi-ai` (completeSimple), existing WriteQueue, existing Context7Client, vitest

---

## 文件结构

| 路径 | 职责 |
|---|---|
| `src/memory/tasks/types.ts` | Task / Phase / TasksFile 类型定义 |
| `src/memory/tasks/manager.ts` | TasksManager：CRUD + 重试计数 + WriteQueue 串行写 |
| `src/memory/tasks/__tests__/manager.test.ts` | TasksManager 单元测试 |
| `src/core/task-planner/phase-signal.ts` | 解析 agent 输出里的 `[TASK_START]` / `[PHASE_DONE]` |
| `src/core/task-planner/__tests__/phase-signal.test.ts` | 信号解析测试 |
| `src/core/task-planner/feedback-detector.ts` | 关键词匹配：识别自然语言负反馈 |
| `src/core/task-planner/__tests__/feedback-detector.test.ts` | 负反馈检测测试 |
| `src/core/task-planner/intent-classifier.ts` | LLM 意图分类 + 任务命名（用 completeSimple） |
| `src/core/task-planner/__tests__/intent-classifier.test.ts` | 意图分类测试（mock completeSimple） |
| `src/core/task-planner/task-context-builder.ts` | 构建每轮消息前置的任务上下文字符串 |
| `src/core/task-planner/__tests__/task-context-builder.test.ts` | 上下文构建测试 |
| `src/core/task-planner/ctx7-retry-builder.ts` | 用 LLM 总结问题 → ctx7 查询 → 返回文档片段 |
| `src/core/task-planner/__tests__/ctx7-retry-builder.test.ts` | ctx7 重试流程测试（mock） |
| `src/extension/hooks/memory.ts` | 追加任务管理 system prompt 指令 |
| `src/extension/index.ts` | REPL 主循环：接入意图分类 / Phase UI / 重试流程 |
| `src/cli/command-parser.ts` | 新增 `/task` 命令（重命名 / 查看状态） |

---

## Task 1：Task + Phase 数据类型与 Manager

**Files:**
- Create: `src/memory/tasks/types.ts`
- Create: `src/memory/tasks/manager.ts`
- Create: `src/memory/tasks/__tests__/manager.test.ts`

- [ ] **Step 1: 写 types.ts**

```typescript
// src/memory/tasks/types.ts
export type PhaseStatus = 'in_progress' | 'completed';
export type TaskStatus = 'active' | 'completed';

export interface TaskPhase {
  id: string;
  description: string;
  status: PhaseStatus;
  retry_count: number;
  feedbacks: string[];
  created_at: string;
  completed_at?: string;
}

export interface Task {
  id: string;
  name: string;
  active_phase_index: number;
  phases: TaskPhase[];
  status: TaskStatus;
  created_at: string;
}

export interface TasksFile {
  active_task_id: string | null;
  tasks: Task[];
}
```

- [ ] **Step 2: 写 manager.ts 的失败测试**

```typescript
// src/memory/tasks/__tests__/manager.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TasksManager } from '../manager.js';

describe('TasksManager', () => {
  let mgr: TasksManager;

  beforeEach(() => {
    TasksManager.resetInstance();
    mgr = TasksManager.getInstance(':memory:');
  });

  it('creates a task with initial phase', async () => {
    const task = await mgr.createTask('修改首页', ['调整颜色', '验证渲染']);
    expect(task.name).toBe('修改首页');
    expect(task.phases).toHaveLength(2);
    expect(task.active_phase_index).toBe(0);
    expect(task.status).toBe('active');
  });

  it('increments retry count for active phase', async () => {
    const task = await mgr.createTask('测试任务', ['Phase 1']);
    await mgr.incrementRetry(task.id, 'css 不渲染');
    const updated = await mgr.getActive();
    expect(updated!.phases[0].retry_count).toBe(1);
    expect(updated!.phases[0].feedbacks).toEqual(['css 不渲染']);
  });

  it('advances to next phase', async () => {
    const task = await mgr.createTask('测试任务', ['Phase 1', 'Phase 2']);
    await mgr.completePhase(task.id);
    const updated = await mgr.getActive();
    expect(updated!.active_phase_index).toBe(1);
    expect(updated!.phases[0].status).toBe('completed');
  });

  it('renames active task', async () => {
    const task = await mgr.createTask('旧名字', ['p1']);
    await mgr.renameTask(task.id, '新名字');
    const updated = await mgr.getActive();
    expect(updated!.name).toBe('新名字');
  });

  it('returns null when no active task', async () => {
    expect(await mgr.getActive()).toBeNull();
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
cd /home/nashorya/student_agent && npm test -- src/memory/tasks/__tests__/manager.test.ts
```
Expected: FAIL — `manager.js` not found

- [ ] **Step 4: 实现 manager.ts**

```typescript
// src/memory/tasks/manager.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { WriteQueue } from '../../core/write-queue.js';
import type { Task, TaskPhase, TasksFile } from './types.js';

export class TasksManager {
  private static instance: TasksManager | null = null;
  private readonly filePath: string;

  private constructor(memoryDir: string) {
    this.filePath = memoryDir === ':memory:'
      ? ':memory:'
      : join(memoryDir, 'tasks.json');
    this._memStore = null;
  }

  private _memStore: TasksFile | null;

  static getInstance(memoryDir?: string): TasksManager {
    const dir = memoryDir ?? `${process.cwd()}/memory`;
    if (!TasksManager.instance) {
      TasksManager.instance = new TasksManager(dir);
    }
    return TasksManager.instance;
  }

  static resetInstance(): void {
    TasksManager.instance = null;
  }

  async createTask(name: string, phaseDescriptions: string[]): Promise<Task> {
    const task: Task = {
      id: `task_${Date.now()}`,
      name,
      active_phase_index: 0,
      phases: phaseDescriptions.map((desc, i) => ({
        id: `phase_${Date.now()}_${i}`,
        description: desc,
        status: 'in_progress',
        retry_count: 0,
        feedbacks: [],
        created_at: new Date().toISOString(),
      })),
      status: 'active',
      created_at: new Date().toISOString(),
    };

    await this._write(async (file) => {
      file.tasks.push(task);
      file.active_task_id = task.id;
    });

    return task;
  }

  async getActive(): Promise<Task | null> {
    const file = await this._read();
    if (!file.active_task_id) return null;
    return file.tasks.find((t) => t.id === file.active_task_id) ?? null;
  }

  async incrementRetry(taskId: string, feedback: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const phase = task.phases[task.active_phase_index];
      if (!phase) return;
      phase.retry_count++;
      phase.feedbacks.push(feedback);
    });
  }

  async completePhase(taskId: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const phase = task.phases[task.active_phase_index];
      if (phase) {
        phase.status = 'completed';
        phase.completed_at = new Date().toISOString();
      }
      if (task.active_phase_index < task.phases.length - 1) {
        task.active_phase_index++;
      } else {
        task.status = 'completed';
        file.active_task_id = null;
      }
    });
  }

  async renameTask(taskId: string, newName: string): Promise<void> {
    await this._write(async (file) => {
      const task = file.tasks.find((t) => t.id === taskId);
      if (task) task.name = newName;
    });
  }

  private async _read(): Promise<TasksFile> {
    if (this.filePath === ':memory:') {
      return this._memStore ?? { active_task_id: null, tasks: [] };
    }
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as TasksFile;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return { active_task_id: null, tasks: [] };
      }
      throw err;
    }
  }

  private async _write(mutate: (file: TasksFile) => Promise<void> | void): Promise<void> {
    if (this.filePath === ':memory:') {
      const file = this._memStore ?? { active_task_id: null, tasks: [] };
      await mutate(file);
      this._memStore = file;
      return;
    }
    await WriteQueue.getInstance().enqueue(async () => {
      const file = await this._read();
      await mutate(file);
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
    });
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npm test -- src/memory/tasks/__tests__/manager.test.ts
```
Expected: 5 tests PASS

- [ ] **Step 6: 类型检查**

```bash
tsc --noEmit
```
Expected: 无报错

- [ ] **Step 7: Commit**

```bash
git add src/memory/tasks/
git commit -m "feat: add TasksManager with phase lifecycle and retry counting"
```

---

## Task 2：Phase 信号解析器

**Files:**
- Create: `src/core/task-planner/phase-signal.ts`
- Create: `src/core/task-planner/__tests__/phase-signal.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/core/task-planner/__tests__/phase-signal.test.ts
import { describe, it, expect } from 'vitest';
import { parsePhaseSignal, stripPhaseSignals } from '../phase-signal.js';

describe('parsePhaseSignal', () => {
  it('parses TASK_START signal', () => {
    const text = `[TASK_START name="调整首页颜色"]
Phase 1: 分析当前 CSS
Phase 2: 修改颜色值
Phase 3: 验证微信渲染
[/TASK_START]`;
    const result = parsePhaseSignal(text);
    expect(result).toEqual({
      type: 'task_start',
      name: '调整首页颜色',
      phases: ['分析当前 CSS', '修改颜色值', '验证微信渲染'],
    });
  });

  it('parses PHASE_DONE signal', () => {
    const text = `[PHASE_DONE phase=1]
已完成：将 opacity 写法改为 hex 值。
下一步：验证微信渲染效果。
[/PHASE_DONE]`;
    const result = parsePhaseSignal(text);
    expect(result).toEqual({
      type: 'phase_done',
      phaseIndex: 1,
      summary: '已完成：将 opacity 写法改为 hex 值。',
      nextStepHint: '下一步：验证微信渲染效果。',
    });
  });

  it('returns null when no signal', () => {
    expect(parsePhaseSignal('普通的回复内容')).toBeNull();
  });

  it('stripPhaseSignals removes signal blocks from text', () => {
    const text = `做了一些修改。\n[PHASE_DONE phase=1]\n已完成。\n[/PHASE_DONE]\n请确认。`;
    expect(stripPhaseSignals(text)).toBe('做了一些修改。\n\n请确认。');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/core/task-planner/__tests__/phase-signal.test.ts
```
Expected: FAIL

- [ ] **Step 3: 实现 phase-signal.ts**

```typescript
// src/core/task-planner/phase-signal.ts
export type PhaseSignal =
  | { type: 'task_start'; name: string; phases: string[] }
  | { type: 'phase_done'; phaseIndex: number; summary: string; nextStepHint: string };

const TASK_START_RE = /\[TASK_START name="([^"]+)"\]([\s\S]*?)\[\/TASK_START\]/;
const PHASE_DONE_RE = /\[PHASE_DONE phase=(\d+)\]([\s\S]*?)\[\/PHASE_DONE\]/;

export function parsePhaseSignal(text: string): PhaseSignal | null {
  const taskMatch = TASK_START_RE.exec(text);
  if (taskMatch) {
    const phases = taskMatch[2]
      .split('\n')
      .map((l) => l.replace(/^Phase \d+:\s*/, '').trim())
      .filter(Boolean);
    return { type: 'task_start', name: taskMatch[1], phases };
  }

  const doneMatch = PHASE_DONE_RE.exec(text);
  if (doneMatch) {
    const lines = doneMatch[2].trim().split('\n').map((l) => l.trim()).filter(Boolean);
    const summary = lines.find((l) => l.startsWith('已完成')) ?? lines[0] ?? '';
    const nextStepHint = lines.find((l) => l.startsWith('下一步')) ?? '';
    return { type: 'phase_done', phaseIndex: Number(doneMatch[1]), summary, nextStepHint };
  }

  return null;
}

export function stripPhaseSignals(text: string): string {
  return text
    .replace(/\[TASK_START[^\]]*\][\s\S]*?\[\/TASK_START\]/g, '')
    .replace(/\[PHASE_DONE[^\]]*\][\s\S]*?\[\/PHASE_DONE\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/core/task-planner/__tests__/phase-signal.test.ts
```
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/task-planner/
git commit -m "feat: add phase signal parser for TASK_START and PHASE_DONE"
```

---

## Task 3：自然语言负反馈检测器

**Files:**
- Create: `src/core/task-planner/feedback-detector.ts`
- Create: `src/core/task-planner/__tests__/feedback-detector.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/core/task-planner/__tests__/feedback-detector.test.ts
import { describe, it, expect } from 'vitest';
import { detectNegativeFeedback } from '../feedback-detector.js';

describe('detectNegativeFeedback', () => {
  it.each([
    ['还是不行', true],
    ['没有效果', true],
    ['还是这个样子', true],
    ['不对，颜色还是错的', true],
    ['没用', true],
    ['这不是我想要的', true],
    ['改了但没变化', true],
    ['好的，继续下一步', false],
    ['帮我修改首页', false],
    ['这样可以了', false],
  ])('"%s" → isNegative: %s', (input, expected) => {
    expect(detectNegativeFeedback(input).isNegative).toBe(expected);
  });

  it('returns the input as extractedText', () => {
    const result = detectNegativeFeedback('还是不行，颜色没变');
    expect(result.extractedText).toBe('还是不行，颜色没变');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/core/task-planner/__tests__/feedback-detector.test.ts
```

- [ ] **Step 3: 实现 feedback-detector.ts**

```typescript
// src/core/task-planner/feedback-detector.ts
export interface FeedbackSignal {
  isNegative: boolean;
  extractedText: string;
}

const NEGATIVE_PATTERNS = [
  /还是(不行|不对|这样|没变|错的|有问题)/,
  /没有?效果/,
  /没用/,
  /不对[，,。]?/,
  /改了但没?变/,
  /这不是我想要的/,
  /不是这个意思/,
  /看起来(还是|仍然)(不对|有问题)/,
  /还是(原来的|旧的|之前的)/,
];

export function detectNegativeFeedback(input: string): FeedbackSignal {
  const isNegative = NEGATIVE_PATTERNS.some((re) => re.test(input));
  return { isNegative, extractedText: input };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/core/task-planner/__tests__/feedback-detector.test.ts
```
Expected: 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/task-planner/feedback-detector.ts src/core/task-planner/__tests__/feedback-detector.test.ts
git commit -m "feat: add natural language negative feedback detector"
```

---

## Task 4：LLM 意图分类器

**Files:**
- Create: `src/core/task-planner/intent-classifier.ts`
- Create: `src/core/task-planner/__tests__/intent-classifier.test.ts`

- [ ] **Step 1: 写失败测试（mock completeSimple）**

```typescript
// src/core/task-planner/__tests__/intent-classifier.test.ts
import { describe, it, expect, vi } from 'vitest';
import { classifyIntent } from '../intent-classifier.js';

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: vi.fn(),
}));

import { completeSimple } from '@mariozechner/pi-ai';

const mockModel = { id: 'test', api: 'anthropic', provider: 'anthropic' } as any;

describe('classifyIntent', () => {
  it('returns new_task with extracted name', async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"type":"new_task","task_name":"修改首页颜色方案"}' }],
    } as any);
    const result = await classifyIntent('帮我改首页的颜色', null, mockModel);
    expect(result).toEqual({ type: 'new_task', taskName: '修改首页颜色方案' });
  });

  it('returns continue when LLM says continue', async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"type":"continue"}' }],
    } as any);
    const result = await classifyIntent('好的，继续', '修改首页', mockModel);
    expect(result).toEqual({ type: 'continue' });
  });

  it('falls back to continue on LLM error', async () => {
    vi.mocked(completeSimple).mockRejectedValueOnce(new Error('network'));
    const result = await classifyIntent('随便说一句', null, mockModel);
    expect(result.type).toBe('continue');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/core/task-planner/__tests__/intent-classifier.test.ts
```

- [ ] **Step 3: 实现 intent-classifier.ts**

```typescript
// src/core/task-planner/intent-classifier.ts
import { completeSimple, type Model, type Api } from '@mariozechner/pi-ai';

export type IntentType = 'new_task' | 'continue';

export interface IntentResult {
  type: IntentType;
  taskName?: string;
}

const SYSTEM_PROMPT = `你是一个意图分类器。判断用户输入属于哪种意图：
- "new_task"：用户在描述一个新任务（改某个功能、做某件事）
- "continue"：用户在继续当前任务、提问、或做其他操作

输出严格 JSON，不加任何解释。格式：
新任务：{"type":"new_task","task_name":"简短任务名（15字以内）"}
其他：{"type":"continue"}`;

export async function classifyIntent(
  input: string,
  currentTaskName: string | null,
  model: Model<Api>,
): Promise<IntentResult> {
  const context = currentTaskName
    ? `当前任务：${currentTaskName}\n用户输入：${input}`
    : `当前任务：无\n用户输入：${input}`;

  try {
    const result = await completeSimple(model, {
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: context }] }],
    });

    const text = result.content.find((c) => c.type === 'text')?.text ?? '';
    const jsonMatch = /\{[\s\S]*\}/.exec(text);
    if (!jsonMatch) return { type: 'continue' };

    const parsed = JSON.parse(jsonMatch[0]) as { type: string; task_name?: string };
    if (parsed.type === 'new_task') {
      return { type: 'new_task', taskName: parsed.task_name };
    }
    return { type: 'continue' };
  } catch {
    return { type: 'continue' };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/core/task-planner/__tests__/intent-classifier.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 5: 类型检查**

```bash
tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/core/task-planner/intent-classifier.ts src/core/task-planner/__tests__/intent-classifier.test.ts
git commit -m "feat: add LLM intent classifier for new task detection"
```

---

## Task 5：任务上下文构建器 + System Prompt 指令

**Files:**
- Create: `src/core/task-planner/task-context-builder.ts`
- Create: `src/core/task-planner/__tests__/task-context-builder.test.ts`
- Modify: `src/extension/hooks/memory.ts`

- [ ] **Step 1: 写 task-context-builder 失败测试**

```typescript
// src/core/task-planner/__tests__/task-context-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildTaskContextPrefix } from '../task-context-builder.js';
import type { Task } from '../../../memory/tasks/types.js';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task_1',
  name: '调整首页颜色',
  active_phase_index: 1,
  phases: [
    { id: 'p0', description: '分析 CSS', status: 'completed', retry_count: 0, feedbacks: [], created_at: '' },
    { id: 'p1', description: '修改颜色值', status: 'in_progress', retry_count: 2,
      feedbacks: ['颜色还是不对', '微信里还是灰色'], created_at: '' },
  ],
  status: 'active',
  created_at: '',
  ...overrides,
});

describe('buildTaskContextPrefix', () => {
  it('includes task name and current phase', () => {
    const prefix = buildTaskContextPrefix(makeTask());
    expect(prefix).toContain('调整首页颜色');
    expect(prefix).toContain('Phase 2');
    expect(prefix).toContain('修改颜色值');
  });

  it('includes retry count when > 0', () => {
    const prefix = buildTaskContextPrefix(makeTask());
    expect(prefix).toContain('2 次');
  });

  it('includes previous feedbacks', () => {
    const prefix = buildTaskContextPrefix(makeTask());
    expect(prefix).toContain('颜色还是不对');
  });

  it('returns empty string when task is null', () => {
    expect(buildTaskContextPrefix(null)).toBe('');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/core/task-planner/__tests__/task-context-builder.test.ts
```

- [ ] **Step 3: 实现 task-context-builder.ts**

```typescript
// src/core/task-planner/task-context-builder.ts
import type { Task } from '../../memory/tasks/types.js';

export function buildTaskContextPrefix(task: Task | null, ctx7Docs?: string): string {
  if (!task) return '';

  const phase = task.phases[task.active_phase_index];
  if (!phase) return '';

  const lines: string[] = [
    `[当前任务] ${task.name}`,
    `[当前 Phase] Phase ${task.active_phase_index + 1}/${task.phases.length}：${phase.description}`,
  ];

  if (phase.retry_count > 0) {
    lines.push(`[注意] 此 Phase 已重试 ${phase.retry_count} 次，用户反馈：`);
    phase.feedbacks.forEach((f) => lines.push(`  - ${f}`));
  }

  if (ctx7Docs) {
    lines.push('[参考文档]');
    lines.push(ctx7Docs);
  }

  return lines.join('\n') + '\n\n';
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/core/task-planner/__tests__/task-context-builder.test.ts
```
Expected: 4 tests PASS

- [ ] **Step 5: 在 memory.ts 追加任务管理 system prompt 指令**

在 `src/extension/hooks/memory.ts` 的 `createMemoryHook` 返回的字符串末尾追加：

```typescript
// 在 memory.ts 内部，拼接 parts 之后追加：
parts.push(`
## 任务管理输出格式（必须遵守）

当你理解用户意图并准备开始一个新任务时，在第一条回复的开头输出：
[TASK_START name="任务简称（15字以内）"]
Phase 1: 第一步描述
Phase 2: 第二步描述
...（2-5个Phase）
[/TASK_START]

当你认为当前 Phase 的工作已完成时，在回复末尾输出：
[PHASE_DONE phase=N]
已完成：一句话描述完成的内容。
下一步：下一个 Phase 的简要说明。
[/PHASE_DONE]

N 是当前 Phase 的编号（从 1 开始）。不要在未完成时输出这些标记。
`);
```

- [ ] **Step 6: 类型检查**

```bash
tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/core/task-planner/task-context-builder.ts src/core/task-planner/__tests__/task-context-builder.test.ts src/extension/hooks/memory.ts
git commit -m "feat: task context builder and system prompt task management instructions"
```

---

## Task 6：Context7 重试构建器

**Files:**
- Create: `src/core/task-planner/ctx7-retry-builder.ts`
- Create: `src/core/task-planner/__tests__/ctx7-retry-builder.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/core/task-planner/__tests__/ctx7-retry-builder.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildCtx7RetryContext } from '../ctx7-retry-builder.js';

vi.mock('@mariozechner/pi-ai', () => ({ completeSimple: vi.fn() }));
import { completeSimple } from '@mariozechner/pi-ai';

const mockModel = { id: 'test', api: 'anthropic', provider: 'anthropic' } as any;
const mockCtx7 = { query: vi.fn() };

describe('buildCtx7RetryContext', () => {
  it('queries ctx7 with LLM-extracted keywords', async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Taro 小程序 CSS 颜色渲染' }],
    } as any);
    mockCtx7.query.mockResolvedValueOnce({ docs: '# Taro CSS\n不支持 CSS 变量...' });

    const result = await buildCtx7RetryContext(
      '调整首页颜色',
      ['颜色不对', '还是灰色', '微信不渲染'],
      mockCtx7 as any,
      mockModel,
    );

    expect(mockCtx7.query).toHaveBeenCalledWith('Taro 小程序 CSS 颜色渲染');
    expect(result).toContain('不支持 CSS 变量');
  });

  it('returns empty string when ctx7 returns no docs', async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce({
      content: [{ type: 'text', text: '关键词' }],
    } as any);
    mockCtx7.query.mockResolvedValueOnce(null);

    const result = await buildCtx7RetryContext('任务', ['反馈'], mockCtx7 as any, mockModel);
    expect(result).toBe('');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/core/task-planner/__tests__/ctx7-retry-builder.test.ts
```

- [ ] **Step 3: 实现 ctx7-retry-builder.ts**

```typescript
// src/core/task-planner/ctx7-retry-builder.ts
import { completeSimple, type Model, type Api } from '@mariozechner/pi-ai';
import type { Context7Client } from '../../knowledge/context7-client.js';

export async function buildCtx7RetryContext(
  taskName: string,
  feedbacks: string[],
  ctx7Client: Pick<Context7Client, 'query'>,
  model: Model<Api>,
): Promise<string> {
  let keywords = '';
  try {
    const result = await completeSimple(model, {
      systemPrompt: '根据任务描述和失败反馈，提取 2-5 个最关键的技术搜索关键词（空格分隔，不加标点）。只输出关键词，不加任何解释。',
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: `任务：${taskName}\n失败反馈：\n${feedbacks.join('\n')}` }],
      }],
    });
    keywords = result.content.find((c) => c.type === 'text')?.text?.trim() ?? '';
  } catch {
    keywords = taskName;
  }

  if (!keywords) return '';

  try {
    const docs = await ctx7Client.query(keywords);
    if (!docs?.docs) return '';
    return docs.docs;
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/core/task-planner/__tests__/ctx7-retry-builder.test.ts
```
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/task-planner/ctx7-retry-builder.ts src/core/task-planner/__tests__/ctx7-retry-builder.test.ts
git commit -m "feat: add ctx7 retry builder with LLM keyword extraction"
```

---

## Task 7：REPL 集成 + `/task` 命令

**Files:**
- Modify: `src/extension/index.ts`
- Modify: `src/cli/command-parser.ts`

### 7A：新增 `/task` 命令

- [ ] **Step 1: 在 command-parser.ts 加 `/task` 类型**

在 `SlashCommand` union 里加：
```typescript
| { type: 'task'; subcommand: 'rename'; name: string }
| { type: 'task'; subcommand: 'status' }
```

在 `COMMANDS` 数组里加 `'/task'`。

在 `parseCommand` 的 switch 里加：
```typescript
case 'task': {
  if (args[0] === 'rename' && args.length >= 2) {
    return { type: 'task', subcommand: 'rename', name: args.slice(1).join(' ') };
  }
  return { type: 'task', subcommand: 'status' };
}
```

在 `getHelpText()` 里加：
```
    /task                 查看当前任务状态
    /task rename <名字>   重命名当前任务
```

- [ ] **Step 2: 类型检查**

```bash
tsc --noEmit
```

### 7B：REPL 主循环接入任务管理

- [ ] **Step 3: 在 `index.ts` 顶部追加 imports**

```typescript
import { TasksManager } from '../memory/tasks/manager.js';
import { parsePhaseSignal, stripPhaseSignals } from '../core/task-planner/phase-signal.js';
import { detectNegativeFeedback } from '../core/task-planner/feedback-detector.js';
import { classifyIntent } from '../core/task-planner/intent-classifier.js';
import { buildTaskContextPrefix } from '../core/task-planner/task-context-builder.js';
import { buildCtx7RetryContext } from '../core/task-planner/ctx7-retry-builder.js';
```

- [ ] **Step 4: 在 `RuntimeState` 接口里加 `model` 字段**

```typescript
interface RuntimeState {
  config: StudentAgentConfig;
  model: Model<Api>;           // ← 新增，供 classifyIntent 使用
  session: ...;
  agent: ...;
  escalation: FailureEscalationContext;
  renderer: EventRenderer;
  unsubscribe: () => void;
}
```

在 `createRuntime` 里返回 `model`：
```typescript
return { config, model, session, agent, escalation, renderer, unsubscribe };
```

- [ ] **Step 5: 处理 `/task` 命令**

在 REPL switch 的 `case 'setting':` 后面加：

```typescript
case 'task': {
  const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
  const activeTask = await tasksMgr.getActive();
  if (command.subcommand === 'status') {
    if (!activeTask) {
      console.log(chalk.dim('  当前无活跃任务。'));
    } else {
      const phase = activeTask.phases[activeTask.active_phase_index];
      console.log(chalk.cyan(`  任务：${activeTask.name}`));
      console.log(chalk.dim(`  Phase ${activeTask.active_phase_index + 1}/${activeTask.phases.length}：${phase?.description}`));
      console.log(chalk.dim(`  当前 Phase 重试次数：${phase?.retry_count ?? 0}`));
    }
  } else if (command.subcommand === 'rename') {
    if (!activeTask) {
      console.log(chalk.yellow('  当前无活跃任务。'));
    } else {
      await tasksMgr.renameTask(activeTask.id, command.name);
      console.log(chalk.green(`  已重命名为：${command.name}`));
    }
  }
  continue;
}
```

- [ ] **Step 6: 改造正常任务提交段落**

将现有的任务提交代码替换为：

```typescript
// ── 负反馈检测 ────────────────────────────────
const feedback = detectNegativeFeedback(userInput);
const tasksMgr = TasksManager.getInstance(MEMORY_DIR);
const activeTask = await tasksMgr.getActive();

if (feedback.isNegative && activeTask) {
  await tasksMgr.incrementRetry(activeTask.id, userInput);
  const refreshed = await tasksMgr.getActive();
  const phase = refreshed!.phases[refreshed!.active_phase_index];

  let ctx7Docs = '';
  if (phase.retry_count >= 3 && runtime.config.features.context7) {
    console.log(chalk.yellow('  [ctx7] 三次反馈，正在查阅文档...'));
    ctx7Docs = await buildCtx7RetryContext(
      refreshed!.name,
      phase.feedbacks,
      new Context7Client({
        apiKey: runtime.config.context7.apiKey,
        timeoutMs: runtime.config.context7.timeoutMs,
        maxDocsChars: runtime.config.context7.maxDocsChars,
      }),
      runtime.model,
    );
    if (ctx7Docs) console.log(chalk.dim('  [ctx7] 已获取参考文档，注入重试上下文。'));
  }

  const prefix = buildTaskContextPrefix(refreshed, ctx7Docs || undefined);
  currentTaskDescription = userInput;
  runtime.escalation.initTask(userInput, CWD);
  markReflectBaseline();

  try {
    await runTaskWithAbort(runtime, prefix + userInput);
  } catch (err) {
    console.error(chalk.red('Task error:'), err instanceof Error ? err.message : String(err));
  }
} else {
  // ── 意图分类（新任务 or 继续）────────────────
  const intent = await classifyIntent(
    userInput,
    activeTask?.name ?? null,
    runtime.model,
  );

  if (intent.type === 'new_task' && intent.taskName) {
    // 不急着创建 Task，等 agent 输出 [TASK_START] 后再创建
    // 这里只记录候选名字
    currentTaskDescription = userInput;
  } else {
    currentTaskDescription = userInput;
  }

  const prefix = buildTaskContextPrefix(activeTask ?? null);
  runtime.escalation.initTask(userInput, CWD);
  markReflectBaseline();

  let agentOutput = '';
  const originalUnsubscribe = runtime.unsubscribe;
  // 临时订阅收集 agent 输出文本
  const textBuffer: string[] = [];
  const textSub = runtime.agent.subscribe((event) => {
    if (event.type === 'assistant_message' || event.type === 'text_delta') {
      textBuffer.push((event as any).delta ?? (event as any).content ?? '');
    }
  });

  try {
    await runTaskWithAbort(runtime, prefix ? prefix + userInput : userInput);
    agentOutput = textBuffer.join('');
  } catch (err) {
    console.error(chalk.red('Task error:'), err instanceof Error ? err.message : String(err));
  } finally {
    textSub();
  }

  // ── Phase 信号处理 ────────────────────────────
  const signal = parsePhaseSignal(agentOutput);

  if (signal?.type === 'task_start') {
    const task = await tasksMgr.createTask(
      intent.taskName ?? signal.name,
      signal.phases,
    );
    console.log(chalk.cyan(`\n  [任务开始] ${task.name}`));
    task.phases.forEach((p, i) =>
      console.log(chalk.dim(`    Phase ${i + 1}: ${p.description}`)),
    );
  } else if (signal?.type === 'phase_done' && activeTask) {
    console.log(chalk.green(`\n  [Phase ${signal.phaseIndex} 完成] ${signal.summary}`));
    if (signal.nextStepHint) console.log(chalk.dim(`  ${signal.nextStepHint}`));
    const answer = await rl.question(chalk.cyan('  进入下一步？(Y/n): '));
    if (answer.trim().toLowerCase() !== 'n') {
      await tasksMgr.completePhase(activeTask.id);
      console.log(chalk.green('  已进入下一 Phase。'));
    }
  }
}

// 三级失败升级后的提问（保持原有逻辑）
const pendingQ = runtime.escalation.takePendingQuestion();
if (pendingQ) {
  console.log(chalk.yellow('\n  [需要你的帮助] ' + pendingQ.context));
  const answer = await rl.question(chalk.yellow('  你的回答（直接回车跳过）: '));
  if (answer.trim()) {
    await QuestionsManager.getInstance(MEMORY_DIR).resolve(pendingQ.id, answer.trim());
    console.log(chalk.green('  已记录，下次遇到类似问题会参考。'));
  }
}
```

> **注意**：agent 输出文本收集需确认 Pi 的事件类型字段名（`event.type` 的值），必要时在 Step 6 前先用 `console.log` 打印一条真实事件观察字段名，再写收集逻辑。

- [ ] **Step 7: 类型检查**

```bash
tsc --noEmit
```
修复所有报错后继续。

- [ ] **Step 8: 手动冒烟测试**

```bash
npm run dev
```
验证：
1. 输入普通任务（如"帮我改首页颜色"）→ 不报错，正常运行
2. 输入 `/task` → 显示当前任务状态或"无活跃任务"
3. 输入负反馈词（"还是不行"）→ 不崩溃

- [ ] **Step 9: Commit**

```bash
git add src/extension/index.ts src/cli/command-parser.ts
git commit -m "feat: wire task phase manager into REPL main loop"
```

---

## 自检

**Spec coverage:**
- [x] `/feedback down` 等价于自然语言负反馈 → Task 3 + Task 7 Step 6
- [x] 任务自动命名 → Task 4 + Task 7
- [x] Phase 分解（agent 输出 TASK_START）→ Task 2 + Task 7
- [x] Phase 完成确认（agent 输出 PHASE_DONE）→ Task 2 + Task 7
- [x] 第 3 次负反馈 → ctx7 查询 → 注入重试 → Task 6 + Task 7
- [x] 重试计数持久化 → Task 1（tasks.json）
- [x] `/task rename` → Task 7A
- [x] system prompt 指令 → Task 5

**风险点：**
- Task 7 Step 6 中 agent 输出文本收集的事件字段名未确认，需在真实运行中验证
- `completeSimple` 的 `content` 字段结构假设为 `{type:'text', text:string}[]`，需在 Task 4 Step 3 类型检查通过后再确认
