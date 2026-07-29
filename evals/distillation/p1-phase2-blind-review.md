# P1 阶段 2 · 盲审表（作者填）

- memory: `evals/results/swebench/openrouter-sonnet-tier-b-on-memory-p1gate-20260718`
- main lessons: 0 (verified=0, candidate=0)
- ephemeral: 12
- verified 占比（主库）: N/A（主库空）
- 验收线: 主库 verified ≥50%；盲审 ≥3/5 可用

| # | lesson 摘要 | 是否可用（作者 0/1） | 备注 |
|---|---|---|---|
| 1 | Treat tool error as a retry pattern: Hashline: astropy/io/fits/fitsrec.py has changed since last read (tag 57C9 is stale, current is 2D77). Re-read the file bef |  |  |
| 2 | Treat tool error as a retry pattern: Hashline: astropy/io/fits/fitsrec.py has changed since last read (tag B2E9 is stale, current is 2D77). Re-read the file bef |  |  |
| 3 | Treat tool error as a retry pattern: Hashline: astropy/wcs/wcs.py has changed since last read (tag 37A6 is stale, current is 17FB). Re-read the file before edit |  |  |
| 4 | Avoid repeating stale edits after Hashline stale rejection: astropy/io/fits/fitsrec.py |  |  |
| 5 | Avoid repeating stale edits after Hashline stale rejection: astropy/wcs/wcs.py |  |  |

> 来源（main/ephemeral）与 confidence 对作者隐藏；agent 侧对照表见 `p1-phase2-blind-key.json`。

## 召回命中附记（非验收）

本批 run 未观察到 usedRecallIds 非空实例（n 小如实记）。
