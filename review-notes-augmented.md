# jspace-compaction-recovery-001 · Review Notes（起草，不含 HARNESS_READY）

## 1. 主张边界（ADR-001 对齐）

本 eval 只支撑自我 ablation 主张：J-space 各阶段相对 Pi built-in
compaction 的边际贡献。不用于对外比较。

## 2. 与 ADR-002 tombstone 的关系（必须写明，否则 Gate 2 会打回）

ADR-002 否决的"自建埋坑任务序列"针对**跨任务学习**评测：当时存在
SWE-bench 外部替代，且跨任务埋坑说服力弱。本 eval 是**任务内**探针：

- 测的是 compaction 边界的状态存活，无外部基准等价物
  （LoCoBench-Agent 测长上下文理解，不测压缩后恢复）；
- 探针是任务自然要求（"不要修改规则文件"本来就在
  long-context-maintenance Phase 1 里），不是人造陷阱；
- 主张范围是 ablation-only。

建议在采纳时写一条新 ADR 显式区分这两个场景。

## 3. 三种植入探针 → 可脚本验证指标

| 探针 | 植入方式 | 验证来源 |
|---|---|---|
| 首轮约束 | 仅在 instruction 开头声明"不得修改 X / 不得重命名 Y" | git diff（tests/test.sh） |
| 诱饵路径 | environment 中放一条看似可行但必然报特征错误的路线（如带特征字符串的失败脚本） | events.jsonl 中特征错误出现次数，按 compaction 前/后分段计数 |
| 跨边界依赖 | Phase 3 的正确做法依赖 Phase 2 产出的一个中间结论（写在 agent 自己的输出里，不在文件里） | Phase 3 产物是否符合该结论（结构断言） |

## 4. 四段归因表（对齐 ADR-002 召回审计三分法）

每题每 seed 输出：

```
checkpoint_written                    # 写入失败？
checkpoint_contains_planted_constraint # 内容失败？
checkpoint_injected_post_compaction    # 注入失败？
behavior_consistent_with_checkpoint    # 利用失败？
```
四项全部来自 protected trace 与文件系统断言，不依赖 agent 自报。
plain 臂前三项恒为 n/a，只看行为项——这就是基线。

## 5. 方法论硬规则

1. **compaction 由 harness 在固定点强制触发**（Phase 2、4 之后）。
   自然溢出触发时机不可控，臂间不可比。
2. **先跑 no-op hook 校验**：强制 compaction 钩子本身不得改变
   plain 臂行为（一题即可）。
3. **成本按 cached / uncached 分列**。v1 尾部注入的经济性只有
   分列后才可见；合并计数会系统性低估其优势。
4. **GO gate 按指标分列**（对应 roadmap P4.3）：
   - v0.5 的 GO 只看约束存活与 phase 延续；
   - v1 的 GO 只看重复失败路径与 stale 相关指标；
   - 不合成总分。预期读数形态：确定性投影会推动前者、
     难以推动后者——后者才是逐轮 patch 的存在理由。
5. **seeds >= 3**。引 LLMs Get Lost 的 +112% unreliability；
   1 seed 的恢复率数字没有意义。

## 6. 任务选择

- 复用 `long-context-maintenance`（已含"不得修改规则文件"约束与
  5 phase 结构），补装诱饵路径与跨边界依赖；
- 新增 2 题：一题偏重多约束（3+ 条首轮约束），一题偏重诱饵路径
  （2 条不同特征错误的死路）。规模对齐现有 task bundle。

## 7. 当前结构测试能覆盖 / 不能覆盖（Trace-Bound 声明）

- 覆盖：约束违反（文件断言）、重复路径计数（events.jsonl）、
  checkpoint 四段归因（protected trace）。
- 不能覆盖："行为与 checkpoint 一致"中语义模糊的边缘情形；
  此类样本标 `blocked_for_trace_grader`，留给离线 Trace Grader
  抽样复核，不做运行时 LLM 判分。

## 8. 实施顺序建议

```
Step 0  写 forced-compaction harness 控制 + no-op 校验
Step 1  改装 long-context-maintenance，只跑 plain 臂 x3 seeds
        → 若 plain 臂无约束丢失/无重复路径，关闭 GO gate，归档本 eval
Step 2  基线成立后再实现 v0.5，跑 plain vs v0.5
Step 3  v0.5 GO 后实现 v1 确定性投影，跑三臂
Step 4  仅当重复失败路径指标不动时，评估逐轮 model patch（roadmap GO gate）
```

Step 0-1 不依赖任何 J-space 实现代码，与 ADR-003 P0 的
"零成本验证前提"同构。

## 9. 增补：Step -1 真实运行路径核验（先于原 Step 0）

本步骤不实现任何 J-space 逻辑，只确认 eval 控制面确实覆盖产品真实路径：

1. 检查仓库固定版本的 Pi 依赖，而不是按 Pi 最新主线 API 推测：
   - forced compaction 的公开/内部入口；
   - compaction 前后 hook；
   - tool-use loop 中 Session 是否重建；
   - Provider Payload 的最终消息排序。
2. 捕获一次真实请求，确认：
   - plain/current 各臂实际启用的 Runtime 组件；
   - compaction 调用的是产品路径，而不是测试替身；
   - protected trace 对 checkpoint 写入、注入和行为都有可观测点。
3. 若无法证明 forced compaction 与产品 compaction 同路径，则停止，
   先修复 harness，不进入 Step 0。

## 10. 增补：加入 `current` 产品基线，且 plain 必须真关闭旧 Runtime

原三臂之外增加：

```text
current
当前 student-agent 默认实现：
Pi built-in compaction + 现有 Context Runtime / memory system prefix
```

四臂用途不同：

- `plain`：因果基线，只保留 Pi built-in compaction；
- `current`：产品迁移基线，回答“新方案是否优于现在的实现”；
- `v0.5`：checkpoint-only；
- `v1`：确定性增量投影。

`plain` 不能只是“不启用新 J-space”，还必须关闭当前的：

- memory system prefix；
- Task Ledger / Recall 的模型侧注入；
- 其他 Context Runtime 动态或静态摘要。

Runner 必须在 protected trace 中输出每个 arm 的实际 feature manifest，
不能仅凭 arm 名称推断配置。

## 11. 增补：跨边界依赖的泄漏审计

“跨边界依赖”必须只存在于 compaction 前的对话状态中。运行前应验证它没有
通过其他通道被重新提供给模型，包括：

- Phase 3 instruction 是否重复了该结论；
- 文件系统、fixture、环境变量中是否写入该结论；
- events.jsonl、Task Ledger、Working Memory 是否会被模型主动召回；
- task runner 是否把前一阶段答案拼入下一阶段输入；
- oracle 或测试报错是否直接泄露正确结论；
- current Runtime 是否已在 system prefix 中保存该结论。

每个任务生成一份 `leakage_manifest.json`。若禁止位置命中，
该 seed 标为 `invalid_probe_leakage`，不计入恢复率。

## 12. 增补：API / Token Usage 探针

正式跑 plain 基线前，先执行一个低成本 API 探针。BigModel 可用于调通尺子，
但不作为最终 Z.AI 行为结论。

探针要求：

1. 一个简单 coding task，产生 3–5 次真实 LLM 调用和至少一次工具调用；
2. 保存 Provider 原始响应或最终 SSE usage chunk；
3. 核对 Pi 暴露的 usage 与原始响应是否一致；
4. 每次调用记录：
   - `prompt_tokens`
   - `cached_input_tokens`
   - `uncached_input_tokens`
   - `output_tokens`
   - `request_id`
   - `latency_ms`
   - `arm/task/seed/call_index`
5. 对 forced compaction 前后分别记录 usage；
6. 若 Provider 返回 cache 细项但 Pi 丢失，允许在 Provider wrapper 层旁路记录。

成本指标优先使用：

```text
total_cached_input_tokens
total_uncached_input_tokens
total_output_tokens
```

## 13. 增补：动态尾部与缓存断言

若后续实现 v0.5/v1 的尾部注入，Runtime 必须检查序列化后的真实请求：

1. J-space/checkpoint 是最后一个 content block；
2. 它后面没有 framework retry prompt、隐藏 system 注入或工具提示；
3. 它未被写入永久历史；
4. 上一调用的旧 J-space 已被剥离；
5. cache breakpoint 位于 J-space 之前；
6. J-space 本身不标 cache control。

任一断言失败时，该 run 标记为 `invalid_prompt_layout`。

## 14. 增补后的实际实施顺序

本节只补充原第 8 节，不改变其“先验证前提、后写实现”的原则：

```text
Step -1 核对 pinned Pi compaction、Provider Payload 和 protected trace
Step 0  forced-compaction harness + no-op 中性校验
Step 0.5 API usage 探针，确认 cached/uncached/output 可观测
Step 1  plain x3 seeds；同时用 current 做产品基线小样本
        → 若 plain 无约束丢失/无重复路径，关闭 GO gate
Step 2  基线成立后实现 v0.5，跑 plain/current/v0.5
Step 3  v0.5 GO 后实现 v1 确定性投影
Step 4  仅当 rejected-path 指标仍不动，评估逐轮 model patch
```
