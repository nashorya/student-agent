# student-agent

> **真正的大师，永远都怀着一颗学徒的心。**

一个有自知之明的 CLI 编程代理——领域聚焦（编程）、知道边界（知道何时问）、有记忆（可回滚，能学习）。基于 [pi](https://github.com/badlogic/pi-mono) 二次开发。

[English README](README.md)

---

## 特性

- **TUI 界面** — 基于 Ink/React 的终端 UI，支持流式输出、底部状态栏、命令历史。非 TTY 环境（CI、管道）自动降级为纯文本 REPL。
- **记忆与反思** — 跨会话学习重复出现的操作模式，通过信任状态机升级已验证的 preference；架构层面的变更需用户确认，不自动写入。
- **失败升级梯队** — 每次执行前自动打 git 快照。失败后：回滚 → 降级策略重试 → 升级给用户处理。
- **知识检索** — Context7 精确版本库文档检索，可选 Playwright 读取动态网页。
- **质量监控** — 跨会话被动退化检测，常驻 Footer 静默图标，不打断当前任务。
- **子代理编排** — 并发子代理调度，Write Intent 冲突检测，git worktree 隔离。

## 前置条件

- Node.js 20+
- 本地克隆 `pi-mono` 源码：

```bash
git clone https://github.com/badlogic/pi-mono pi-mono
```

## 快速开始

```bash
# 1. 克隆本仓库
git clone <this-repo> student-agent
cd student-agent

# 2. 克隆 pi-mono 依赖
git clone https://github.com/badlogic/pi-mono pi-mono

# 3. 安装依赖
npm install

# 4. 配置环境变量
cp .env.example .env
# 编辑 .env，至少填写 ANTHROPIC_API_KEY
```

**`.env` 最少需要：**

| 变量 | 说明 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 |
| `ANTHROPIC_BASE_URL` | 使用代理时填写，否则留空 |

```bash
# 5. 启动
npm run dev
```

## 命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动代理（TTY 下 TUI，否则纯文本 REPL） |
| `npm run build` | 编译 TypeScript |
| `npm test` | 运行 Vitest 测试 |
| `tsc --noEmit` | 类型检查（改完代码必须跑） |

## 配置

运行时行为可通过 `.env` 或 `.student-agent.json` 调整。主要功能开关：

| 开关 | 默认值 | 说明 |
|---|---|---|
| `STUDENT_AGENT_FEATURE_CONTEXT7` | `true` | 库文档检索 |
| `STUDENT_AGENT_FEATURE_PLAYWRIGHT` | `false` | 动态网页读取 |
| `STUDENT_AGENT_FEATURE_BOUNDED_BREAKER` | `true` | 模式泛化 + 置信度评分 |
| `STUDENT_AGENT_FEATURE_QUALITY_WATCHDOG` | `true` | 被动质量退化检测 |
| `STUDENT_AGENT_FEATURE_SUB_AGENTS` | `false` | 并发子代理编排 |

如需开启 Playwright：

```bash
npx playwright install chromium
# 然后在 .env 中设置 STUDENT_AGENT_FEATURE_PLAYWRIGHT=true
```

## 架构概览

```
输入 → 核心代理（Planner → Executor → State Machine）
             ↓                      ↓
      知识检索层                失败升级梯队
  （Context7 / Playwright）  （快照 → 回滚 → 重试）
             ↓
      记忆层（preferences / candidates / Reflect Agent）
             ↓
      TUI（Ink/React 状态栏 + 流式输出）
```

完整架构设计见 [`docs/student-agent-architecture-v0.3.md`](docs/student-agent-architecture-v0.3.md)。

## 许可证

MIT
