# Student Agent

基于 pi（badlogic/pi-mono）二次开发的 CLI 编程代理。完整架构设计：@docs/student-agent-architecture-v0.3.md

## 命令

```bash
npm run dev        # Pi 集成入口（TTY 下自动启用 TUI 界面）
npm run dev:legacy # 旧 XState 入口（待删除）
npm run build      # 编译
npm test           # 运行测试
tsc --noEmit       # 类型检查（改完代码必须跑）
```

## TUI 界面

TTY 环境下 `npm run dev` 自动启用基于 Ink 的 TUI 界面：
- **主输出区**：对话历史 + 流式 Assistant 输出
- **底部状态栏**：任务名、Phase 进度、重试次数、工具调用数、耗时、状态
- **输入行**：历史记录（↑↓箭头）、Escape 中止任务、多行粘贴自动转换为空格
- **降级**：非 TTY 环境（CI、管道）自动切换为纯文本 readline REPL

## 项目结构

```
src/
├── core/
│   ├── config/           # 三层配置加载（default → file → env）
│   ├── executor/         # git 快照回滚
│   ├── state-machine/    # 错误分类 + 诊断报告
│   ├── pi-bridge/        # Pi SDK 类型转换（不承载业务策略）
│   ├── write-queue.ts    # 串行写入队列
│   └── env.ts            # .env 解析
├── extension/
│   ├── index.ts          # REPL 主入口
│   └── hooks/            # snapshot / failure-escalation / memory / reflect / quality-watchdog
├── memory/
│   ├── candidates/       # preference-candidates.json + 信任状态机
│   ├── preferences/      # preferences 双通道写入
│   ├── questions/        # questions.json
│   └── docs-index/       # sqlite-vec（dormant，未接入主流程）
├── knowledge/
│   ├── context7-client.ts    # Context7 REST v2/v1 fallback
│   ├── playwright-reader.ts  # Readability + Turndown
│   └── domain-whitelist.ts   # exact/suffix + private IP deny
├── reflect/
│   ├── reflect-agent.ts      # 模式→候选→升级
│   ├── bounded-breaker.ts    # 置信度评估 + 泛化门槛
│   ├── pattern-rules.ts      # 9 条确定性提取规则
│   └── diff-parser.ts        # diff 解析
├── watchdog/
│   ├── watchdog.ts           # 退化检测（≥2 信号告警）
│   ├── feedback-collector.ts # /feedback 采集
│   └── benchmark-runner.ts   # 沙箱基准测试
├── tui/
│   ├── index.ts              # startTUI() + isTTY() 入口
│   ├── app.tsx               # App 根组件（OutputArea + InputLine + StatusBar）
│   ├── state.ts              # AppState / AppAction / reducer / Context
│   ├── bridge.ts             # TUIBridge（EventRenderer → AppState 桥接）
│   └── components/           # StatusBar / OutputArea / InputLine
└── orchestrator/
    ├── orchestrator.ts       # 并发子代理调度
    ├── planner.ts            # 写意图冲突检测
    ├── pi-subagent-executor.ts
    └── worktree-manager.ts   # git worktree 隔离
memory/                       # 运行时记忆（project-rules.md 手动维护，其余自动生成）
```

## 工程基础

pi 源码在 ./pi-mono/，只读，只通过 import 使用其 API。了解 Pi 能力读 ./pi-mono/packages/coding-agent/README.md。

## 核心约束

- memory/ 文件只通过 Manager 类读写，所有写入经 WriteQueue 串行化
- 写入工具调用前必须有 git 快照；只读工具按白名单跳过快照
- pi-bridge 只做类型转换，不承载业务策略
- 候选升级经信任状态机（CandidatesManager.decidePromotion），Breaker 只产报告
- architecture scope 候选需用户确认，不自动写入 preferences
- 不得修改 memory/project-rules.md
- 不得将 Playwright cookie 写入日志或 memory/
- 不得引入架构文档未说明的外部依赖

## 开发阶段

```
阶段一（最小闭环）：✅  状态机 + Executor + 失败升级 + questions
阶段二（记忆层）：  ✅  preferences 双通道 + candidates + Reflect Agent + sqlite-vec
Pi 集成：          ✅  extension/hooks 四钩子 + pi-bridge 类型边界
阶段三（增强）：    ✅  Context7 + Playwright + Bounded Breaker + Orchestrator + Watchdog + Feature Flags
当前：             ✅  TUI 界面（Ink + React，TTY 检测 + 降级）
```

## 遇到架构问题时

停下来，给出 2-3 个选项和取舍，等待确认后再动手。
