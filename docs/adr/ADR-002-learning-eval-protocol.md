# ADR-002 · 学习 eval：别人的题 + 自己的协议

- **日期**：2026-06-11
- **状态**：已采纳；astropy pilot 完成，扩量暂缓

## 决策

学习曲线评测采用"外部任务 + 自有协议"：从 SWE-bench 选取**同一仓库**
（候选：django，100+ 实例）按时间顺序排成序列，跑两臂——
memory 跨任务保留（on）vs 每题清空（off）。题目与打分均来自官方 harness，
自建部分仅一行协议："任务间记忆是否保留"。

## 产出要求

不止分数，要失败归因表。每题记录三项审计（数据源 events.jsonl）：

1. **召回审计**：召回了哪些 lesson/knack，trace 中是否被实际使用
   → 区分写入失败 / 召回失败 / 利用失败
2. **重复错误对账**：本题错误是否为前序任务已记录的同类
3. **污染检查**：memory on 反而变差的题，是否召回了误导性旧结论
   （顺带验证 Task Ledger rejection 机制）

## 定位

此 eval 是 evo harness（v0.5）的前置门槛与适应度函数：
被动记忆测不出正收益，则不启动自动进化；结果决定 v0.4x 组件优先级。

## 2026-06-12 pilot 结论

OpenRouter Sonnet astropy 六题、1 seed 完成。on/off resolved 均为 4/6；
跨任务归档与 recall 链路已跑通，但召回内容主要是临时工具/环境错误，未观察到
明确利用证据。聚合效率改善由单题离群值主导，排除该题后 on 成本回涨。

因此按本 ADR 的门槛暂不启动 django 扩量或 seed 2，先修 lesson/knack 准入、
排序和利用审计。完整数据见
[Tier B 结果报告](../tier-b-openrouter-sonnet-20260612.md)。

## 被否方案（tombstone，勿重提）

- ⏸ 自建埋坑任务序列（任务 2/4 故意踩任务 1/3 的坑）：设计成本高、
  自出题说服力弱，降级为后续补充，待外部题版本出结果后再议。

## 关联

- 前置依赖：BUG-001 修复（benchmark 接入 context runtime）、
  `--memory-dir` 隔离 flag（接线计划 P2-7）。
