你的任务是实现 v0.34 的第三步：注入 hashline 格式说明到 agent prompt，写集成测试，并验证与现有 SnapshotManager 共存。

## 前置：先读这些文件

1. src/extension/index.ts — 搜索 buildMemoryPrompt、systemPrompt、ContextBuilder，了解 prompt 如何组装和注入
2. src/extension/hooks/snapshot.ts — 现有的 git snapshot hook，理解它的 createSnapshotHook 模式
3. src/core/hashline/index.ts — 你之前创建的模块
4. node_modules/@oh-my-pi/hashline/README.md — 读前 100 行，了解 hashline 对用户/模型的格式说明

## 步骤

### 1. 创建 hashline prompt 片段

创建 src/core/hashline/prompt-fragment.ts，导出常量 HASHLINE_PROMPT。

内容要准确描述 hashline 的实际行为：

- read 返回时会附带 ¶path#tag 格式的 anchor
- edit 时可以引用这个 tag 替代精确复述 old_text
- tag 过期时 edit 会被拒绝，需要重新 read 获取新 tag
- session 内连续编辑同一文件时会自动尝试 3-way merge recovery

措辞要和 hashline README 中的描述一致，不要自己编造格式。

### 2. 注入 prompt

在 src/extension/index.ts 中找到 prompt 组装的位置，把 HASHLINE_PROMPT 作为固定注入块加入。

具体注入方式取决于你在第 1 步读到的现有模式：

- 如果有 buildMemoryPrompt：在其返回值中拼接
- 如果有 systemPrompt 拼接：在那里加入
- 如果有 ContextBuilder：用它的 API 注入

选择最符合现有代码模式的方式。HASHLINE_PROMPT 是固定文本，不能让 agent 修改它。

### 3. 验证与 SnapshotManager 共存

两个 snapshot 层：

- Hashline InMemorySnapshotStore = 文件级 content hash，验证编辑锚点，生命周期绑定 session（内存中）
- SnapshotManager（src/core/executor/snapshot.ts）= git-level checkpoint/rollback，灾难恢复（磁盘上）

确认以下几点（读代码验证，不需要改代码）：

- snapshot.ts 的 hook 检查 toolMayMutate() 后走 git stash，不依赖 hashline 的任何东西
- hashline store 不写磁盘，不碰 .git 目录
- 两者可以同时运行，互不干扰

如果发现冲突点，在代码中加注释说明，但大概率是没有冲突的。

### 4. 写集成测试

创建 src/core/hashline/__tests__/hashline-integration.test.ts，使用 vitest。

测试用例（全部用真实临时目录 + 真实文件，不要 mock hashline）：

0. polyfill 生效：在测试文件最顶部 import '../../hashline/bun-polyfill.js'，然后 import hashline 的 computeFileHash，调用它确认不报 "Bun is not defined"，且对相同输入返回相同输出
1. tag 生成：创建临时文件，通过 StudentAgentFilesystem 读取后，store.record() 返回 4 位 hex tag
2. 正常 edit：用正确 tag 调用 Patcher apply，成功修改文件内容
3. stale rejection：read 后在外部直接修改文件内容，用旧 tag edit，被 reject。验证 drainProtectedEvents() 返回的事件中有 type === 'stale_rejection'
4. recovery：同一 session 内连续 edit 同文件 3 次，第 3 次用第 1 次的 tag（如果 hashline 支持这种 recovery）。验证 drainProtectedEvents() 中有 type === 'recovery_success'
5. ProtectedEvalEvent 收集：执行若干操作后，drainProtectedEvents() 返回正确数量和类型的事件，且每个事件都有 timestamp 字段

注意：第 4 个测试取决于 hashline 的 recovery 机制实际如何工作。如果 hashline 不支持这种 recovery 模式，把测试改为验证 recovery_failure 也可以。关键是 ProtectedEvalEvent 被正确写入。

### 5. 跑测试和类型检查

运行：

    npx vitest run src/core/hashline/__tests__/hashline-integration.test.ts

确认全部通过。然后运行：

    npx tsc --noEmit

确认类型检查通过。

## 约束

- prompt 注入是固定文本常量，不能运行时动态生成，不能让 agent 修改
- 不要修改 src/extension/hooks/snapshot.ts 的逻辑
- 测试中必须验证 ProtectedEvalEvent 的写入（stale_rejection 和 recovery）
- 测试用 vitest，和项目已有测试保持一致
