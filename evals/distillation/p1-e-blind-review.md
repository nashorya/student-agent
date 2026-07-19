# P1-E · 盲审表（蒸馏供给入主库）

- **供给路径**：蒸馏(events) → LessonWriter.findCausalPair 门控 → `lessons.jsonl` → harness 晋升
- memory: `evals/results/swebench/openrouter-sonnet-tier-b-on-memory-p1prom-20260718-zenmux`
- **主库**：3 条（verified=3 / candidate=0）→ verified 占比 **100%**
- 全部来自蒸馏 symptom+fix；过程噪声旧主库 0 条状态已接续翻盘
- harness：resolved 3/6；本表 3 条均对应 resolved 并已 promote
- unresolved 三题：events 无 stream exit-0 且无 harness 外证 → 蒸馏合法 null（非后门）
- **验收线**：n=3 时按 ADR-003 的 3/5 比例折算为 **≥2/3**（判卷前公证）
- **判定合计：2/3 通过** → P1 **合页**

| # | lesson 摘要 | 是否可用（作者 0/1） | 备注 |
|---|---|---|---|
| 1 | Symptom: confirmed. Fix: to assign the result of `replace` back to `output_field`:The fix is in place. | **0** | symptom 格为诊断口水话（"confirmed."），检索钥匙失效 |
| 2 | Symptom: In the `_arithmetic_mask` method… | **1** | 可用 |
| 3 | Symptom: In `_cstack`, when `right` is an ndarray… | **1** | 可用 |

> 来源/confidence/instance 对照见 `p1-e-blind-key.json`。
>
> 跟进（只登记）：**蒸馏表述保真度 v2** — `extractSymptom` 改抓任务侧错误表象；
> fix 截断按句取整。证据：本表 #1 symptom/fix 错格。
