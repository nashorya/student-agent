# ADR-004 · Knack Schema v1（定稿）

- **日期**：2026-06-13
- **状态**：已采纳

## 背景

P0 离线蒸馏（`evals/distillation/candidate-knacks.json`）产出 6 条 verified knack，
暴露了 tentative schema（ADR-003）的两个真实问题：

1. **重复蒸馏**：6938 和 14995 各出现 2 条，不同 run 对同一 bug 各自产出一条，
   导致库里有语义重复的知识。
2. **verified_fix 过长**：字段当前是完整的 trace 叙述段落（200–600 字），
   注入时消耗大量 token，且难以让模型快速提取"下一步动作"。

本 ADR 在 ADR-003 的 tentative schema 基础上定稿字段，同时规定去重和召回行为。

## 决策

### Schema v1（完整字段）

```jsonc
{
  // ── 身份 ───────────────────────────────────────
  "id": "knack-<repo_slug>-<hex8>",        // hex8 = sha256(repo+symptom)[:8]
  "dedup_key": "<repo_slug>:<symptom_fp>", // symptom_fp = sha256(normalized_symptom)[:12]
                                            // 相同 dedup_key 的条目视为同一知识，合并取最短 span
  "repo": "astropy/astropy",

  // ── 知识本体 ─────────────────────────────────
  "symptom": "...",          // 1-2 句根因描述（优先提取 "The bug is" / "Root cause:" marker）
  "fix_summary": "...",      // ≤30 词的一句话动作（提取 "The fix is" / "Fix:" 后第一句）
  "verified_fix": "...",     // 完整叙述（仅存档，不注入召回窗口）

  // ── 证据 ──────────────────────────────────────
  "evidence_task": "astropy__astropy-6938",
  "evidence_turns": [5, 12],             // [首次出现 turn, 修复完成 turn]

  // ── 分类 ──────────────────────────────────────
  "compression_level": "knack",          // lesson | knack | rule
  "confidence": "verified",              // verified | candidate

  // ── 运行时状态（随使用更新）──────────────────
  "reuse_count": 0,                      // 每次 recall + citation + task success +1
  "injected_count": 0,                   // 每次被召回注入 +1（不论是否引用）
  "last_succeeded_task": null,           // 最近一次成功利用的 task id
  "last_injected_task": null,            // 最近一次被注入的 task id（Cross-time Replay 用）

  // ── 验证 ──────────────────────────────────────
  "unit_test": "Verified by verifier reward=1 on astropy-6938 turn 12"
}
```

### 字段使用规则

**注入召回窗口时只注入**：`symptom` + `fix_summary`（两字段合计 ≤80 词）。
`verified_fix` 仅在人工审计或蒸馏复审时读取，不进入 agent context。

**去重规则**：蒸馏脚本在写入前按 `dedup_key` 检查：
- 若库中已有相同 `dedup_key`，比较 `evidence_turns` span（end - start）；
- 保留 span 更短的（更精确的因果对），另一条丢弃；
- 若 span 相同，保留较新的 `evidence_task`（时间上更近的验证）。

**fix_summary 提取优先级**（蒸馏脚本执行顺序）：
1. 正则匹配 `The fix is[:\s]+(.+?)[.\n]`
2. 正则匹配 `Fix[:\s]+(.+?)[.\n]`
3. 正则匹配 `The solution is[:\s]+(.+?)[.\n]`
4. Fallback：取 verified_fix 第一句，截断至 150 字符

**symptom 提取优先级**（同上）：
1. `The bug is[:\s]+(.+?)[.\n]`
2. `Root cause[:\s]+(.+?)[.\n]`
3. `The issue is[:\s]+(.+?)[.\n]`
4. Fallback：第一个工具报错的首行，截断至 150 字符

### 召回行为（P2 去 recency 偏置前置规则）

排序权重（降序）：
1. `reuse_count`（被验证利用次数）
2. `confidence = verified` 优于 `candidate`
3. 语义相似度（symptom + fix_summary 的 embedding 与当前错误的相似度）
4. **recency 降权**：`last_injected_task` 越近，权重越低（防止同一 knack 连续注入无效占位）

### 生命周期与降级

| 条件 | 动作 |
|---|---|
| `injected_count ≥ 3` 且 `reuse_count = 0` | 降级为 `confidence: candidate` |
| `injected_count ≥ 6` 且 `reuse_count = 0` | 移入 `knacks/deprecated/` 目录，不再召回 |
| `reuse_count ≥ 2` | 升级为高优先级候选，考虑提炼为 `rule`（compression_level 上移） |

---

## 对蒸馏脚本的修改要求

现有 `scripts/distill-knacks.ts` 需要在此 schema 基础上补充：

1. 新增 `fix_summary` 提取逻辑（按上述优先级）
2. 新增 `dedup_key` 计算与去重逻辑
3. 新增 `injected_count` / `last_succeeded_task` / `last_injected_task` 字段（初始为 0 / null）
4. 重新产出 `candidate-knacks.json`，预期从 6 条去重至 4 条（6938 和 14995 各保留 1 条）

---

## 被否方案（tombstone）

- ⏸ **verified_fix 全文注入**：token 消耗不可控（单条 200-600 词），
  注入 4 条即超过一般 L2 预算，否决。
- ⏸ **不去重、保留所有重复条目**：重复 knack 在召回时占位，
  挤出其他任务的知识，否决。
- ⏸ **embedding 相似度作为唯一排序**：recency 偏置问题无法解决，
  须与 reuse_count 联合排序，否决单一维度方案。

---

## 关联

- 前置：[ADR-003](ADR-003-v04x-priority-reorder.md)（P0 验收）
- 实现：`scripts/distill-knacks.ts`、`evals/distillation/candidate-knacks.json`
- 下一个：[ADR-005](ADR-005-recall-ranking-protocol.md)（P2 召回排序正式协议，已采纳）
