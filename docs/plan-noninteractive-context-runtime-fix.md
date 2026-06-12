# 计划：让 benchmark 路径真正接入 Context Runtime

## 背景 / 根因

SWE benchmark 走 `runNonInteractive`（`src/extension/index.ts` ~L363），该路径从未在
`TasksManager` 中创建 task。而 `context-assembly.ts` 新管道第一步是
`TasksManager.getActive()`，**无 active task 直接走降级分支**（只渲染 hardcoded +
preferences），L1/L2/L3 整段跳过。已有 trace 证据：
`evals/results/comparison/full-main-contextbreakdown-20260611T065619Z/swe-student-agent/records.json`
中 `layers.L1/L2/L3.sectionCount = 0`、`contextPromptEstimatedTokens = 0`。

第二个漏洞：`createRuntime` 创建 `createContextAssemblyHook` 时未传 `runMode`，
默认 `'interactive'`，导致即使有 task，`EVAL_AUTONOMY_RULE` / 
`ANTHROPIC_EXECUTION_OVERRIDE` 也不会渲染。

## P0 — 接线修复

1. **非交互模式创建并激活 task**
   - 位置：`runNonInteractive`，`reloadConfig()` 之后、`session.prompt(prompt)` 之前。
   - `TasksManager.getInstance(MEMORY_DIR).createTask(goal, [singlePhase])`，
     goal 取 instruction（截断到合理长度），单 phase 即可。
   - 确认 createTask 后的 workflow status 属于 `getActive()` 认可的 active 集合。
   - 运行结束时按退出状态收口：成功 `completeTask`、失败 `blockTask`，
     保证 WorkingMemorySnapshot / run-archive 正常落盘（onSessionEnd 链路）。

2. **透传 runMode**
   - `createContextAssemblyHook({ memoryDir, useNewPipeline, onTrace })` 增加
     `runMode` 透传。
   - 建议加 CLI flag `--run-mode eval`（默认 interactive，不改变日常 TUI 行为），
     `non-interactive-args.ts` 解析后传入 `createRuntime`。

3. **验证 WorkingMemory 自动写入在非交互下生效**
   - trackFileRead / trackFileWrite / trackError 依赖 active task；
     建 task 后应自动生效，跑通后在 trace 里确认 `read_files` 等字段非空。

## P1 — 测试与验收

4. 单测：`context-assembly.test.ts` 增加 case——存在 active task 时，
   非交互 hook 返回的 prompt 含 L1 sections；`runMode: 'eval'` 时含 autonomy rule。
5. 冒烟验收标准（跑任一 SWE 题或本地小任务）：summary JSON 中
   `layers.L1.sectionCount > 0`、`contextPromptEstimatedTokens > 0`、tier 字段存在。
6. 回归：`npx vitest run src/evals/__tests__/claude-code-runner.test.ts`
   （已修复 OpenAI 格式 usage 归一 + rawUsage 落 trace，见该文件 diff，勿覆盖）。

## P2 — benchmark 矩阵补全（P0/P1 完成后）

7. **memory dir 隔离 flag**：CLI 加 `--memory-dir <path>`
   （`agent-runner.ts` 已有 memoryDir option，补 CLI 透传）。
   用途：ablation off 臂 = 每题指向空目录；on 臂 / 学习 eval = 序列共享同一目录。
8. **重跑配对数据**：同两题 astropy，context runtime ON，与本次 OFF 数据成对入库。
   结果 metadata 必须含：git commit hash、model、单价。
9. **cc 侧 cache 核对**：rawUsage 落 trace 后，确认 cc（gpt-5.5 经代理）
   cache=0 是真未命中还是代理丢字段。

## 预期与口径（重要，防止方向跑偏）

- Context runtime 打开后 **token 会增加而非减少**（L1 是向 prompt 注入内容），
  这是预期行为，不要当作退化去"优化"。
- 叙事口径修正：65k vs 286k 的省 token 来自基座 harness
  （精简 L0、schema summary、turn 少、hashline），不归因 context runtime。
- Context runtime 的价值主张 = 质量与跨任务学习，由后续学习 eval
  （memory on/off 序列协议）验证，不在本计划范围。
