# TODO · 蒸馏表述保真度 v2

- **登记**：2026-07-19  
- **状态**：**CLOSED**（作者确认 2026-07-19）  
- **落地**：`5d0b6be4` / `extractSymptom` 任务侧优先 + `softSummarize` 按句取整  
- **对照**：`evals/distillation/p1-fidelity-v2-diff.md`  
- **入档**：3/3 症状换源成功、口水话消失；#1 fix 残留 v1 废话尾缀（v3 候选，不开单）；
  harness reward 沿用，主库 3 verified 焕新  
- **不跟进**：fix 侧口水过滤（注入实验异常再开 v3）  

## v5 脆性登记（2026-07-24，追加）

字面/规范化匹配对同型失真的变体仍具脆性；第五次修同一处即触发转结构性
方案（批量蒸馏 Trace2Skill-2603.25158 / 约束式生成）的评估。本次修复针对
v4 `Files Changed` 黑名单被 Markdown `##` 标题绕过，改为 NFKC、小写化、
标点剥离与空白归一后再匹配；它作为 v1 流水账 / v2 口水话 / v3 测试汇报 /
v4 变更元信息之后的 **v5** 记账，不重置累计计数。

本单不实现批量蒸馏或约束式生成；真实绕过取证见
`evals/distillation/bug-013-v5-blacklist-bypass-20260724.md`。
