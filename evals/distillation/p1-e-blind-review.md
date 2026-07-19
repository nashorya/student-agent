# P1-E · 盲审表（蒸馏供给入主库，作者填）

- **供给路径**：蒸馏(events) → LessonWriter.findCausalPair 门控 → `lessons.jsonl` → harness 晋升
- memory: `evals/results/swebench/openrouter-sonnet-tier-b-on-memory-p1prom-20260718-zenmux`
- **主库**：3 条（verified=3 / candidate=0）→ verified 占比 **100%**
- 全部来自蒸馏 symptom+fix；过程噪声旧主库 0 条状态已接续翻盘
- harness：resolved 3/6；本表 3 条均对应 resolved 并已 promote
- unresolved 三题：events 无 stream exit-0 且无 harness 外证 → 蒸馏器合法产出 null（非后门）
- 验收线：盲审 ≥3/5 可用（本表共 3 条，请全判）

| # | lesson 摘要 | 是否可用（作者 0/1） | 备注 |
|---|---|---|---|
| 1 | Symptom: confirmed. Fix: to assign the result of `replace` back to `output_field`:The fix is in place. |  |  |
| 2 | Symptom: In the `_arithmetic_mask` method (line 525-527), when both operands are present (`else` branch), it calls `handle_mask(self.mask, operand.mask, **kwd…  |  |  |
| 3 | Symptom: In `_cstack`, when `right` is an ndarray (i.e., already a computed coord_matrix from a nested CompoundModel), the code does: ```python cright[-right.…  |  |  |

> 来源/confidence/instance 对作者隐藏；对照见 `p1-e-blind-key.json`。
