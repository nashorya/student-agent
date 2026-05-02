# Student Agent

> "A true master is an eternal student."

基于 pi（badlogic/pi-mono）二次开发的 CLI 编程代理。
TypeScript + Node.js + XState v5 + sqlite-vec + Anthropic SDK。

完整架构设计：@docs/student-agent-architecture-v0.3.md

---

## 命令

```bash
npm run dev        # 开发模式
npm run build      # 编译
npm run test       # 运行测试
tsc --noEmit       # 类型检查（改完代码必须跑，不允许留 type error）
```

## 项目结构

```
src/
├── core/
│   ├── state-machine/    # XState v5 状态机，含 Stream Adapter
│   ├── planner/          # 任务分解
│   └── executor/         # 工具执行 + 快照回滚
├── memory/
│   ├── questions/        # questions.json 读写
│   ├── preferences/      # preferences.md 双通道
│   ├── candidates/       # preference-candidates.json
│   └── docs-index/       # sqlite-vec 向量库
├── retrieval/
│   ├── context7/         # Context7 MCP
│   └── playwright/       # 页面读取
├── reflect/              # Reflect Agent + Bounded Breaker
├── skills/               # 可插拔 skill（含 sub-agent skill）
└── ui/                   # Ink CLI 界面
memory/                   # 运行时记忆文件
docs/                     # 架构文档
```

## 工程基础

本项目基于 pi（./pi-mono）二次开发。
pi 源码在 ./pi-mono/，不得修改，只能通过 import 使用其 API。
需要了解 pi 的能力时读 ./pi-mono/packages/coding-agent/README.md。

## 代码规范

- 使用 ES modules（import/export），不用 CommonJS（require）
- 所有异步函数必须有 try/catch，不允许裸露的 Promise
- 禁止使用 `any`；需要宽松类型时用 `unknown` 并做类型收窄
- 函数超过 40 行考虑拆分
- 每个模块改完必须跑 `tsc --noEmit`

## 架构约束（不得违反）

- XState context 只存 ID 和标志，不存资源实例；Playwright BrowserContext 等由 ResourceManager 持有
- 超时统一用 XState `after(120000)` 配置，禁止用 `setTimeout`
- 所有 SQLite 写入必须通过 WriteQueue 单例（p-queue，concurrency: 1），不直接写盘
- Stream Adapter 是 Anthropic SDK 流式输出和 XState 之间的唯一桥梁，不绕过它
- memory/ 目录下的文件只通过各自的 Manager 类读写，不直接 fs 操作

## 禁止行为

- 不得修改 `memory/project-rules.md`，这是用户手动维护的最高优先级约束
- 不得在没有 git 快照的情况下让 Executor 修改工作区文件
- 不得将 Playwright session cookie 写入任何日志、上下文或 memory/ 文件
- 不得引入架构文档未说明的外部依赖，先提出再等确认
- 不得一次性实现多个模块，一次只做一件事
- 不得跳过阶段一直接实现高级功能（子代理、Bounded Breaker 等）

## 开发阶段

当前应处于哪个阶段，在开始任何实现前先确认：

```
阶段一（最小闭环，必须先完成）：
  1. XState 状态机骨架 + Stream Adapter
  2. Executor 基础工具调用 + git 快照回滚
  3. 三级失败升级阶梯
  4. questions.json 读写

阶段二（记忆层）：
  5. preferences.md 双通道写入
  6. preference-candidates.json + Reflect Agent
  7. sqlite-vec 文档向量索引

阶段三（增强，阶段二完成后）：
  8. Context7 MCP 集成
  9. Playwright 文档读取
  10. Bounded Breaker
  11. Sub-Agent Skill
  12. Quality Watchdog
```

## 遇到架构问题时

停下来，说明遇到了什么问题，给出 2-3 个选项和各自取舍，等待确认后再动手。不要自己决定架构。
