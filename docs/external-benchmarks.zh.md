# 外部 Benchmark 接入说明

本页记录 Terminal-Bench 与 SWE-bench 的 v1 接入方式。目标是先跑通可复现 smoke，不做统一大榜单，也不把结果合并进 LoCoBench 报告。

结果默认写入：

- Terminal-Bench：`evals/results/terminal-bench/<timestamp>/`
- SWE-bench：`evals/results/swebench/<timestamp>/`

## Key 设置

Claude Code lane 与 student-agent lane 可以用不同 key。

Claude Code 走 DeepSeek Anthropic-compatible endpoint：

```bash
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_AUTH_TOKEN=<你的 Claude Code/DeepSeek key>
export ANTHROPIC_MODEL=deepseek-v4-pro
export ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro
export ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
export CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash
export CLAUDE_CODE_EFFORT_LEVEL=max
```

student-agent 走 OpenAI-compatible lane：

```bash
export STUDENT_AGENT_PROVIDER=deepseek
export STUDENT_AGENT_API=openai-completions
export STUDENT_AGENT_BASE_URL=https://api.deepseek.com
export STUDENT_AGENT_MODEL=deepseek-v4-pro
export DEEPSEEK_API_KEY=<你的 student-agent/DeepSeek key>
```

如果你想避免同一个 key 被两条 lane 同时打到 429，就把 `ANTHROPIC_AUTH_TOKEN` 和 `DEEPSEEK_API_KEY` 设成两个不同账号或不同 key。

## 一键对照脚本

默认 DeepSeek 对照流程可以直接跑。你可以二选一配置 key/baseurl：

1. 直接编辑 `scripts/run_benchmark_comparison.py` 顶部的手动配置区：

```python
CLAUDE_CODE_API_KEY = ""
STUDENT_AGENT_API_KEY = ""
CLAUDE_CODE_BASE_URL = "https://api.deepseek.com/anthropic"
STUDENT_AGENT_BASE_URL = "https://api.deepseek.com"
CLAUDE_CODE_MODEL = "deepseek-v4-pro"
STUDENT_AGENT_MODEL = "deepseek-v4-pro"
FLASH_MODEL = "deepseek-v4-flash"
```

2. 或者继续用 shell 环境变量：

```bash
export DEEPSEEK_API_KEY=<你的 key>

npm run eval:comparison:deepseek -- \
  --swe-instances evals/inputs/swebench-lite-2.jsonl \
  --swe-limit 2
```

脚本会硬编码设置 Claude Code 和 student-agent 两条 lane 的 DeepSeek 变量，默认跑：

- SWE-bench Lite：2 个 instance，分别产出 Claude Code/student-agent patch；默认再跑官方 harness。
- Terminal-Bench：固定任务 `overfull-hbox,cobol-modernization,fix-git,prove-plus-comm,modernize-scientific-stack`。

只看会执行什么：

```bash
npm run eval:comparison:deepseek -- --dry-run
```

结果写到 `evals/results/comparison/<timestamp>/`，包含 `plan.json`、每一步日志、`summary.json` 和 `summary.md`。

## Terminal-Bench

Claude Code 对照：

```bash
npm run eval:terminal-bench -- \
  --agent claude-code \
  --model deepseek-v4-pro \
  --n-concurrent 1 \
  --n-tasks 1
```

student-agent custom Harbor adapter：

```bash
npm run eval:terminal-bench -- \
  --agent-import-path benchmarks.terminal_bench.student_agent:StudentAgent \
  --model deepseek-v4-pro \
  --n-concurrent 1 \
  --n-tasks 1
```

先只看 Harbor 命令，不真正执行：

```bash
npm run eval:terminal-bench -- \
  --dry-run \
  --agent-import-path benchmarks.terminal_bench.student_agent:StudentAgent \
  --model deepseek-v4-pro
```

注意：`benchmarks/terminal_bench/student_agent.py` 的默认安装命令是 `npm install -g student-agent`。如果容器里拿不到 npm 包，需要手动覆盖：

```bash
export STUDENT_AGENT_HARBOR_INSTALL_COMMAND='npm install -g <你的 tarball、git url 或容器内路径>'
```

adapter 会先确保容器里有 `node` 和 `npm`。默认 Node 安装走 NodeSource，避免 Debian `npm` 包拉很大的依赖链。如果某个任务镜像已经自带 Node，或者你要自己控制安装方式，可以覆盖：

```bash
export STUDENT_AGENT_HARBOR_NODE_INSTALL_COMMAND='<你的 node/npm 安装命令>'
```

本地缓存任务的 smoke 示例，例如固定跑 `fix-git`：

```bash
export STUDENT_AGENT_PROVIDER=deepseek
export STUDENT_AGENT_API=openai-completions
export STUDENT_AGENT_BASE_URL=https://api.deepseek.com
export STUDENT_AGENT_MODEL=deepseek-v4-pro
export DEEPSEEK_API_KEY=<你的 student-agent/DeepSeek key>

env -u ALL_PROXY -u all_proxy \
  HTTP_PROXY=http://127.0.0.1:6518 \
  HTTPS_PROXY=http://127.0.0.1:6518 \
  STUDENT_AGENT_HARBOR_INSTALL_COMMAND='rm -rf /tmp/student-agent && mkdir -p /tmp/student-agent && tar --exclude=node_modules --exclude=.git --exclude=evals/results -C /mnt/student-agent -cf - . | tar -C /tmp/student-agent -xf - && cd /tmp/student-agent && npm install && npm run build' \
  npm run eval:terminal-bench -- \
    --path $HOME/.cache/harbor/tasks/kzqjKVWxvHZxV5xyLNLqJi \
    --agent-import-path benchmarks.terminal_bench.student_agent:StudentAgent \
    --model deepseek-v4-pro \
    --n-concurrent 1 \
    -- \
    --include-task-name fix-git \
    --mounts '[{"type":"bind","source":"$HOME/student-agent","target":"/mnt/student-agent","read_only":true}]'
```

不要直接 `npm install -g /mnt/student-agent` 配合 read-only mount；npm 安装 bin 时会尝试 `chmod`，容易触发 `EROFS`。也不要把宿主机的 `node_modules` 复制进 Linux 任务容器，macOS 原生依赖可能不兼容。

### student-agent Linux 缓存安装

`benchmarks.terminal_bench.student_agent:StudentAgent` 现在默认支持两类可选缓存挂载：

- `/mnt/student-agent-node`：Linux `node` + `npm` cache。存在时 adapter 复制
  `node/npm/npx`，跳过 NodeSource 网络安装；不存在时回退 NodeSource，并对
  `apt-get` / `curl` 使用重试。
- `/mnt/student-agent-built`：已在 Linux 容器内 build 过的
  `/tmp/student-agent` cache。存在且同时挂载 `/mnt/student-agent` 当前源码时，
  adapter 会复制 built cache，overlay 当前源码，再执行 `npm run build`。

推荐 smoke/run 命令形状：

```bash
npm run eval:terminal-bench -- \
  --path $HOME/.cache/harbor/tasks/<task-cache-root> \
  --agent-import-path benchmarks.terminal_bench.student_agent:StudentAgent \
  --model deepseek-v4-pro \
  --n-concurrent 1 \
  -- \
  --include-task-name fix-git \
  --mounts '[{"type":"bind","source":"$HOME/student-agent","target":"/mnt/student-agent","read_only":true},{"type":"bind","source":"/tmp/student-agent-linux-built-cache","target":"/mnt/student-agent-built","read_only":true},{"type":"bind","source":"/tmp/student-agent-node-cache","target":"/mnt/student-agent-node","read_only":true}]'
```

第三方 verifier 内部如果遇到 Debian/Ubuntu mirror 502，adapter 不能直接改
verifier 脚本；按 task 级别重跑或换稳定镜像。结果记录时要把这类失败标为
verifier/environment noise，不能算 agent 行为失败。

也不要把 secret 写成 `--ae DEEPSEEK_API_KEY=...` 放进命令行；npm/Harbor 可能会把完整参数打印到终端。adapter 会读取已 export 的 student-agent 相关环境变量，并只在容器内运行 agent 时注入。
`npm run eval:terminal-bench` wrapper 检测到 `benchmarks.terminal_bench.student_agent:StudentAgent` 时，会自动把已 export 的 student-agent env 写入临时 env file 并传给 Harbor，跑完删除；命令行里不会展开 key。
当 `--model` 以 `deepseek` 开头时，wrapper 会自动补：

```bash
STUDENT_AGENT_PROVIDER=deepseek
STUDENT_AGENT_API=openai-completions
STUDENT_AGENT_BASE_URL=https://api.deepseek.com
STUDENT_AGENT_MODEL=<--model>
STUDENT_AGENT_EXECUTION_MODE=yolo
STUDENT_AGENT_SUPPRESS_EMBEDDING_REMINDER=1
```

所以 smoke 时通常只需要确保当前 shell 里有 `DEEPSEEK_API_KEY`。

当前 adapter 会优先用 `/tmp/student-agent/node_modules/.bin/tsx /tmp/student-agent/bin/student-agent --prompt <instruction>` 启动。这样可以兼容某些依赖发布为 TypeScript 源码的情况；如果没有本地 `/tmp/student-agent`，才回退到全局 `student-agent --prompt <instruction>`。

adapter 会把 agent 输出和 token/cost summary 写到 Harbor agent 日志目录：

```text
/logs/agent/student-agent.txt
/logs/agent/student-agent-summary.json
```

`student-agent-summary.json` 来自 `student-agent --json-summary`，包含 `inputTokens`、`cacheReadTokens`、`outputTokens`、`costUsd` 和逐次 `usageEvents`。如果任务在 Docker 环境启动前失败，例如镜像拉取超时，则不会有 agent summary，因为 agent 没有真正启动。

adapter 默认会安装 NodeSource Node.js 和 `build-essential`；当前依赖里有 `xxhash` 这类原生模块，干净 Linux 容器里需要编译工具链。

非交互 CLI 也可以直接本地使用：

```bash
student-agent --prompt "修复当前仓库里的测试失败"
student-agent --prompt-file /path/to/instruction.md
student-agent --prompt-file /path/to/instruction.md --json-summary /tmp/student-agent-summary.json
```

长任务或 benchmark instruction 推荐用 `--prompt-file`，避免 shell quoting 干扰。

## SWE-bench

SWE-bench 分两步：先产出官方 `predictions.jsonl`，再交给官方 harness 判分。

本地 instances 文件支持 JSON 或 JSONL，至少包含：

```json
{
  "instance_id": "repo__project-1",
  "repo": "owner/project",
  "base_commit": "abc123",
  "problem_statement": "Fix the bug."
}
```

student-agent 产 patch：

```bash
npm run eval:swebench:produce -- \
  --instances-path /path/to/instances.jsonl \
  --agent student-agent \
  --limit 1
```

Claude Code 产 patch：

```bash
npm run eval:swebench:produce -- \
  --instances-path /path/to/instances.jsonl \
  --agent claude-code \
  --limit 1 \
  --claude-model deepseek-v4-pro
```

只预览会跑哪些 instance，不 clone、不调用模型：

```bash
npm run eval:swebench:produce -- \
  --dry-run \
  --instances-path /path/to/instances.jsonl \
  --agent student-agent \
  --limit 1
```

官方 harness 判分：

```bash
npm run eval:swebench -- \
  --predictions-path evals/results/swebench/<timestamp>/predictions.jsonl \
  --max-workers 1 \
  --run-id student-agent-smoke
```

只预览官方 harness 命令：

```bash
npm run eval:swebench -- \
  --dry-run \
  --predictions-path evals/results/swebench/<timestamp>/predictions.jsonl \
  --max-workers 1
```

## 当前边界

- Terminal-Bench 使用 Harbor live terminal harness；Claude Code 用 Harbor 现成 agent，student-agent 用 custom installed agent。
- SWE-bench producer 只负责生成 patch，不负责判题；判题交给 `python -m swebench.harness.run_evaluation`。
- v1 默认 `n-concurrent=1`、`max-workers=1`，先排除 rate limit 对 harness smoke 的干扰。
- 大规模并发、key pool、跨 benchmark dashboard 暂不放进 v1。
