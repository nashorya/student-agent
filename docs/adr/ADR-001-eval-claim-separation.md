# ADR-001 · 评测口径：跨 agent 对比与自建 eval 严格分离

- **日期**：2026-06-11
- **状态**：已采纳

## 决策

跨 agent 对比（vs claude-code / opencode 等）只使用公开 benchmark
（SWE-bench、terminal-bench、LoCoBench-Agent）；自建 eval 只用于自我 ablation
（memory on/off、context runtime on/off 等），不用于对外宣称优于他人产品。
两类主张在报告与 README 中不混用。

## 理由

自建评测测自己的组件是标准做法（论文 ablation 皆如此），无可指摘；
但"用自己造的题宣称打败别人的产品"没有说服力。分离后各自立得住。

## 被否方案（tombstone，勿重提）

- ❌ 自建任务直接对比 cc：说服力不足，已否。
- ❌ 追求 SWE 全量 300 题统计显著性：预算不允许；改为固定小子集 +
  机制展示（contextBreakdown 曲线）+ 诚实标注 n。

## 关联

- token 效率叙事归因修正见 buglog BUG-001：省 token 归基座 harness，
  不归 context runtime；context runtime 开启后 token 应增加，属预期。
