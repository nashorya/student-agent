Let me check the current codebase structure to make the prompts accurate.

Now let me check the roadmap's v0.34 spec and the eval guide for the exact contracts.

Now I have all the context. Here are the 3 rounds of prompts for student-agent to implement v0.34.

------

## Round 1: 安装依赖 + StudentAgentFilesystem + InMemorySnapshotStore

把这段直接发给 student-agent：

```
你的任务是实现 v0.34 Hashline Anchored Edit 的第一步：安装依赖并建立 Hashline 的文件系统适配层。

## 步骤

### 1. 安装 @oh-my-pi/hashline

```bash
npm install @oh-my-pi/hashline
```

确认版本 >= 15.9.0，确认 node_modules/@oh-my-pi/hashline/dist/ 目录存在。

### 2. 创建 src/core/hashline/filesystem-adapter.ts

实现 `StudentAgentFilesystem`，它需要实现 hashline 包导出的 `Filesystem` 接口。

先读 hashline 的类型定义：

```bash
cat node_modules/@oh-my-pi/hashline/dist/index.d.ts | head -200
```

然后实现：

- `readText(path)`: 用 node:fs/promises 的 readFile 读文件，encoding utf-8
- `writeText(path, content)`: 用现有的 WriteQueue 写入。WriteQueue 在 `src/core/write-queue.ts`，先读这个文件理解它的接口

构造函数接收 `cwd: string`，所有路径都 resolve 到 cwd 下。

### 3. 创建 src/core/hashline/store.ts

初始化 InMemorySnapshotStore：

```ts
import { InMemorySnapshotStore } from '@oh-my-pi/hashline';
```

导出一个工厂函数：

```ts
export function createHashlineStore(): InMemorySnapshotStore {
  return new InMemorySnapshotStore({ maxPaths: 30, maxVersions: 4 });
}
```

先读 hashline 的 InMemorySnapshotStore 构造参数确认字段名是否正确。

### 4. 创建 src/core/hashline/index.ts

重新导出 filesystem-adapter 和 store 的公开接口。

## 约束

- 不要引入 oh-my-pi 的 agent runtime、TUI、provider routing
- 不要修改任何现有文件
- 所有新文件放在 src/core/hashline/ 目录
- 写完后跑 `npx tsc --noEmit` 确认类型检查通过

```
---

## Round 2: Hook 进 read/edit 工具 + ProtectedEvalEvent
```

你的任务是实现 v0.34 的第二步：让 read 工具返回 hashline tag，让 edit 工具使用 Hashline Patcher，并写入 ProtectedEvalEvent。

## 前置：先读这些文件

1. `src/core/pi-bridge/student-file-tools.ts` — 现有的 read/edit/write 工具定义
2. `src/core/pi-bridge/session-factory.ts` — 工具注册和 hook 组装
3. `src/core/hashline/index.ts` — 你在 Round 1 创建的适配层
4. `src/evals/types.ts` — 现有 eval 类型
5. `node_modules/@oh-my-pi/hashline/dist/index.d.ts` — hashline 的 Patcher、SnapshotStore API

## 步骤

### 1. 在 src/evals/types.ts 中添加 ProtectedEvalEvent

在文件末尾添加：

```ts
export interface ProtectedEvalEvent {
  source: 'hashline' | 'signal' | 'toolguard';
  type: string;
  path?: string;
  ruleName?: string;
  provenance?: unknown;
  evidenceRef?: string;
  blocked?: boolean;
  shellSpawned?: boolean;
  timestamp: string;
}
```

在 `StudentAgentEvalTrace` 接口中添加可选字段：

```ts
protectedEvents?: ProtectedEvalEvent[];
```

### 2. 创建 src/core/hashline/event-emitter.ts

创建一个 ProtectedEvalEvent 收集器：

```ts
import type { ProtectedEvalEvent } from '../../evals/types.js';

const events: ProtectedEvalEvent[] = [];

export function emitProtectedEvent(event: Omit<ProtectedEvalEvent, 'timestamp'>): void {
  events.push({ ...event, timestamp: new Date().toISOString() });
}

export function drainProtectedEvents(): ProtectedEvalEvent[] {
  return events.splice(0);
}
```

### 3. 修改 read 工具：返回 hashline tag

在 `src/core/pi-bridge/student-file-tools.ts` 的 `createStudentReadToolDefinition` 中：

- 函数签名改为接收第二个参数：`store?: SnapshotStore`（从 hashline 导入类型）
- 在 execute 方法中，调用 base.execute 拿到结果后，如果 store 存在，对读到的文件内容调用 `store.record(path, content)`，拿到 tag
- 在返回的 resultText 或 details 中附加 `¶path#tag` 格式的 anchor 信息

关键：hashline 的 store.record() 的确切签名需要你先从 hashline 类型定义中确认。如果 record 返回的不是 tag 字符串，需要适配。

### 4. 修改 edit 工具：使用 Hashline Patcher

在 `createStudentEditToolDefinition` 中：

- 函数签名改为接收额外参数：`store?: SnapshotStore, fs?: Filesystem`
- 如果 store 和 fs 都存在，创建 Patcher 实例
- 在 execute 中，如果参数包含 hashline tag（¶path#tag 格式），使用 Patcher.apply() 替代 base.execute
- 如果 tag 过期（stale），Patcher 会尝试 3-way merge recovery：
  - recovery 成功：调用 emitProtectedEvent({ source: 'hashline', type: 'recovery_success', path })
  - recovery 失败：调用 emitProtectedEvent({ source: 'hashline', type: 'recovery_failure', path, blocked: true })，然后 throw error
- 如果 tag 匹配失败且无法 recovery：
  - 调用 emitProtectedEvent({ source: 'hashline', type: 'stale_rejection', path, blocked: true })
  - throw error，错误信息说明 tag 过期，建议重新 read

关键：先读 hashline 的 Patcher API，确认 apply() 的参数和返回值，以及它如何报告 stale/recovery。

### 5. 修改 session-factory.ts：传入 store 和 fs

在 `createStudentSession` 中：

- 创建 hashline store 和 filesystem 实例
- 把它们传给 createStudentReadToolDefinition 和 createStudentEditToolDefinition

### 6. 更新 src/core/hashline/index.ts

重新导出 event-emitter 的公开接口。

## 约束

- 当 store 参数为 undefined 时，read/edit 工具的行为必须与修改前完全一致（向后兼容）
- ProtectedEvalEvent 只能由这些 hashline 内部逻辑写入，不能暴露给 agent prompt
- 跑 `npx tsc --noEmit` 确认类型检查通过
- 不要动 apply-patch-tool.ts（hashline 对 apply_patch 的支持留到后续）

```
---

## Round 3: prompt 注入 + 测试
```

你的任务是实现 v0.34 的第三步：注入 hashline 格式说明到 agent prompt，添加基本测试，并验证与现有 SnapshotManager 的共存。

## 前置：先读这些文件

1. `src/extension/index.ts`（搜索 "buildMemoryPrompt" 和 "ContextBuilder" 了解 prompt 注入方式）
2. `src/extension/hooks/snapshot.ts` — 现有的 git snapshot hook
3. `src/core/hashline/index.ts` — 你之前创建的模块

## 步骤

### 1. 创建 hashline prompt 片段

创建 `src/core/hashline/prompt-fragment.ts`：

```ts
export const HASHLINE_PROMPT = `
## Hashline Anchored Edit

When you read a file, the result includes a hashline tag in the format ¶path#tag.
When editing, you can reference this tag instead of copying the exact old_text.
This eliminates whitespace mismatch errors and stale-read problems.

- read returns: file content + ¶path#tag anchor
- edit accepts: path + tag + newText (no need for exact old_text if tag is fresh)
- If the tag is stale (file changed since you read it), the edit will be rejected. Re-read the file to get a fresh tag.
- Recovery (3-way merge) is attempted automatically for stale tags in chain edits within the same session.
`;
```

确认这段 prompt 的措辞与 hashline 的实际 API 行为一致。先读 hashline 的 README：

```bash
cat node_modules/@oh-my-pi/hashline/README.md | head -100
```

### 2. 注入 prompt

在 `src/extension/index.ts` 中找到 prompt 组装的位置。把 HASHLINE_PROMPT 作为固定注入块加入 system prompt 或 context。

具体注入方式取决于现有代码结构——可能是：

- 拼接到 buildMemoryPrompt 的返回值
- 或加入 piOptions.systemPrompt
- 或通过 ContextBuilder（如果存在）

选择最符合现有模式的方式。

### 3. 验证与 SnapshotManager 共存

两个 snapshot 层的区分：

- Hashline SnapshotStore = 文件级 content hash，验证编辑锚点，session 级别（内存中）
- SnapshotManager = git-level checkpoint/rollback，灾难恢复，持久化（磁盘上）

确认：

- snapshot.ts 的 hook 仍然正常运行（它走 git stash）
- hashline store 的生命周期绑定到 session，不写磁盘
- 两者不互相干扰

### 4. 写基本测试

创建 `src/core/hashline/__tests__/hashline-integration.test.ts`：

测试用例：

1. **tag 生成**：read 一个文件后，store 中有对应 tag
2. **正常 edit**：用正确 tag edit，成功
3. **stale rejection**：read 后在外部修改文件，用旧 tag edit，被 reject，emitProtectedEvent 被调用且 type === 'stale_rejection'
4. **recovery**：同一 session 内连续 edit 同文件 3 次，第 3 次用第 1 次的 tag，应触发 recovery
5. **ProtectedEvalEvent 收集**：执行若干操作后，drainProtectedEvents() 返回正确的事件列表

用 vitest（项目已有 vitest 配置）。可以用临时目录 + 真实文件系统测试，不要 mock hashline 本身。

### 5. 跑测试

```bash
npx vitest run src/core/hashline/__tests__/hashline-integration.test.ts
npx tsc --noEmit
```

## 约束

- prompt 注入必须是固定文本，不能让 agent 修改它
- 不要修改 snapshot.ts 的逻辑
- 测试中 stale_rejection 和 recovery 必须验证 ProtectedEvalEvent 的写入

```
---

## 使用说明

3 轮按顺序发，每轮完成后让 student-agent 跑一遍 `npx tsc --noEmit` 确认无类型错误再发下一轮。每轮大约 800-1200 token 的 prompt，GLM 上下文足够。

Round 2 最复杂——如果 student-agent 卡在 hashline 的 Patcher API 上，让它先跑 `cat node_modules/@oh-my-pi/hashline/dist/index.d.ts` 看完整类型定义再继续。
```