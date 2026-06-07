你的任务是实现 v0.34 的第二步：让 read 工具返回 hashline tag，让 edit 工具使用 Hashline Patcher，并定义 ProtectedEvalEvent。

## 前置：先读这些文件

依次读完再动手：

1. src/core/pi-bridge/student-file-tools.ts — 现有 read/edit/write 工具定义
2. src/core/pi-bridge/session-factory.ts — 工具注册和 hook 组装（重点看 createStudentSession 函数 95-120 行附近）
3. src/core/hashline/index.ts — Round 1 创建的适配层（注意顶部有 bun-polyfill import）
4. src/core/hashline/bun-polyfill.ts — Round 1 创建的 Bun.hash polyfill
5. src/evals/types.ts — 现有 eval 类型（重点看 StudentAgentEvalTrace 和 ToolTraceEntry）
6. node_modules/@oh-my-pi/hashline/src/patcher.ts — hashline 的 Patcher 完整实现（注意：hashline 是 Bun-only 包，main 指向 src/*.ts 而不是 dist，类型从 src 读）
7. node_modules/@oh-my-pi/hashline/src/snapshots.ts — SnapshotStore 接口和 InMemorySnapshotStore

第 6、7 个文件很重要，必须读完才能正确使用 Patcher。

重要：hashline 的 package.json 的 main 是 ./src/index.ts（不是 dist），exports 也指向 src/*.ts。这意味着 import 时直接加载 TS 源码，而不是编译后的 JS。你的 import 路径应该是 '@oh-my-pi/hashline' 即可，TypeScript 会解析到 src/index.ts。确保任何 import hashline 之前 bun-polyfill 已经执行。

## 步骤

### 1. 在 src/evals/types.ts 末尾添加 ProtectedEvalEvent 接口

字段：

    source: 'hashline' | 'signal' | 'toolguard'
    type: string
    path?: string
    ruleName?: string
    provenance?: unknown
    evidenceRef?: string
    blocked?: boolean
    shellSpawned?: boolean
    timestamp: string

然后在 StudentAgentEvalTrace 接口中添加可选字段 protectedEvents?: ProtectedEvalEvent[]

### 2. 创建 src/core/hashline/event-emitter.ts

实现 ProtectedEvalEvent 收集器：

- emitProtectedEvent(event): 接收不含 timestamp 的事件，自动加 timestamp 后存入数组
- drainProtectedEvents(): 取出并清空所有已收集的事件，返回数组

从 src/evals/types.ts 导入 ProtectedEvalEvent 类型。

### 3. 修改 read 工具：返回 hashline tag

修改 src/core/pi-bridge/student-file-tools.ts 中的 createStudentReadToolDefinition：

- 函数签名新增可选参数 store（类型从 hashline 导入，是 SnapshotStore 或 InMemorySnapshotStore）
- 在 execute 方法中（你需要给 base 包一层 execute），调用 base.execute 拿到结果后：
  - 如果 store 存在，从结果中提取文件路径和内容
  - 调用 store.record(path, content)（确认 record 的签名和返回值，从 hashline 类型定义中看）
  - 在返回结果的文本末尾附加一行 anchor 信息，格式: ¶path#tag
- 如果 store 不存在，行为与修改前完全一致

### 4. 修改 edit 工具：使用 Hashline Patcher

修改 createStudentEditToolDefinition：

- 函数签名新增可选参数 store 和 fs（Filesystem 类型）
- 如果 store 和 fs 都存在，创建 Patcher 实例（从 hashline 类型定义确认 Patcher 构造方式）
- 在 prepareArguments 或 execute 中检测参数是否包含 hashline tag（¶path#tag 格式）
- 如果包含 tag，使用 Patcher 替代 base.execute：
  - tag 匹配且 apply 成功：正常返回
  - tag 过期但 3-way merge recovery 成功：调用 emitProtectedEvent，source='hashline', type='recovery_success'
  - tag 过期且 recovery 失败：调用 emitProtectedEvent，source='hashline', type='recovery_failure', blocked=true，然后 throw
  - tag 匹配失败无法 recovery：调用 emitProtectedEvent，source='hashline', type='stale_rejection', blocked=true，然后 throw，错误信息告知 tag 过期需重新 read
- 如果不包含 tag 或 store 不存在，走原来的 base.execute 逻辑

关键：Patcher 的 apply() 如何报告 stale/recovery 完全取决于 hashline 的 API 设计，你必须从类型定义中确认，不要猜。

### 5. 修改 session-factory.ts：传入 store 和 fs

在 createStudentSession 中：

- 在文件顶部 import '../hashline/bun-polyfill.js'（确保在 import hashline 相关内容之前）
- 从 src/core/hashline 导入 createHashlineStore 和 StudentAgentFilesystem
- 在函数开头创建 store 和 fs 实例
- 把 store 传给 createStudentReadToolDefinition
- 把 store 和 fs 传给 createStudentEditToolDefinition

### 6. 更新 src/core/hashline/index.ts

重新导出 event-emitter 的 emitProtectedEvent 和 drainProtectedEvents。

### 7. 验证

运行：

    npx tsc --noEmit

确认类型检查通过。

## 约束

- store 参数为 undefined 时，read/edit 行为必须与修改前完全一致（向后兼容）
- ProtectedEvalEvent 只能由 hashline 内部逻辑写入，不暴露给 agent prompt
- 不要动 apply-patch-tool.ts（hashline 对 apply_patch 的支持留到后续）
- 不要动 bash-timeout-tool.ts 和 student-discovery-tools.ts
