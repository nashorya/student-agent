# 计划：旧版 TUI 与遗留物清理（独立 PR，benchmark 收尾后执行）

## 背景

- `npm run dev` 默认仍走 v1 TUI（ink/react）。v2（pi-tui）需 `STUDENT_AGENT_TUI=v2`。
- 共享基础设施（logger、input-queue、paste-buffer、debug-events、TUIBridge 类型）
  住在 `src/tui/`（v1 目录）里，`extension/index.ts` 直接引用，不能直接删目录。
- 架构文档把 TUI v2 稳定化记在 v0.33，与"默认 v1"现状矛盾，需二选一对齐。

## 步骤（按序执行，每步可独立提交）

1. **切默认到 v2**
   - `src/tui-runtime.ts`：`selectTUIVersion` 默认返回 `'v2'`；
     `STUDENT_AGENT_TUI=v1` 作为逃生口保留。
   - README 注明逃生口；观察期一两周后再做步骤 3。

2. **迁出共享件**
   - 新建 `src/tui-shared/`，移入：`logger.ts`、`input-queue.ts`、`paste-buffer.ts`、
     `prompt-log.ts`、`debug-events.ts`、`terminal.ts`、`bridge.ts`（类型）、
     `console-redirect.ts`（确认引用方）。
   - 更新 `extension/index.ts` 与 tui-v2 的 import 路径。纯移动，不改逻辑。

3. **删除 v1 实现**
   - 删 `src/tui/`（剩余的 app.tsx、components/、state.ts 等 ink 部分）。
   - 卸载依赖：`ink`、`react`、`@types/react`（先全局 grep 确认无其他引用）。
   - 删除 `selectTUIVersion` 的 v1 分支与环境变量逃生口。

4. **卸载 spike 依赖**
   - `@opentui/core`、`@opentui/solid`、`solid-js` 卸载；
     `src/tui-v2/__tests__/opentui-spike.test.ts` 一并删除
     （bun 迁移评估时再恢复，spike 代码可存到 docs 或分支）。

5. **清理遗留文件**
   - `src/multiply.ts`、`src/shopping-cart/`（确认无测试引用后删）
   - `scripts/run_benchmark_comparison copy.py`
   - 根目录：`mariozechner-pi-ai-0.70.3.tgz`、`interview-brief.html`、
     `interview-talk-track.md`、`ui-readability-mockup.*`、
     `Round 1 安装依赖....md`（有价值的移入 docs/ 或 .reference/，无价值的删）
   - `memory/` 运行时文件出 VCS：`recall-index.json`、`tasks.json`、`*.jsonl`
     加入 .gitignore 并 `git rm --cached`；测试依赖的固化为 fixtures。

6. **文档对齐**
   - README / 架构文档统一口径："TUI v2 为默认"。
   - `package.json` 的 description 从 "hello" 改为正式一句话。

## 验收

- `npm run dev` 在 TTY 下起 v2 TUI，无 ink 残留引用（`grep -r "from 'ink'" src` 为空）。
- `npx tsc --noEmit` 通过；vitest 全绿。
- `npm ls ink react solid-js` 均为 empty。
- git status 干净，memory 运行时文件不再出现在 diff 中。

## 注意

- 不要与 benchmark 相关改动混在同一批提交。
- 步骤 2 的"纯移动"提交里不做任何行为修改，方便 review。
