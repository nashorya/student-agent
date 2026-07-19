# Chronicle Graph 解析契约

权威实现与契约注释：`src/archive/knowledge-graph.ts` 文件头。

| 源 | 规则摘要 | 失败策略 |
|---|---|---|
| `docs/buglog.md` | `## BUG-NNN · title` + `**状态**` / `**症状**`；代码围栏内模板忽略 | 缺状态 → parseErrors(path+line) |
| `docs/buglog.md` 图关系 | `- **motivates\|requires\|…** → \`id\` · title` | 非法 token 忽略该行 |
| `docs/adr/ADR-*.md` | `# ADR-NNN`、状态行、`### Pn ·`、Tombstone 表 | 缺 ADR 编号标题 → parseErrors（仍可用 slug id） |
| `docs/adr/*` 图关系 | `## 图关系` + `- **defines** → …` / `- **consumed-by** → …` | 不迁就解析器：文档必须写机读行 |
| `docs/adr/*jspace*` | 非编号 ADR → `ADR:<slug>` + finding 墓碑 | 同时 report 缺编号 |
| `docs/INDEX.md` | 纵向时间轴三列表 | 坏行列 → parseErrors |
| `evals/distillation/*` | 文件节点 + vitals JSON 字段 | 可选目录 |
| `docs/roadmap/*` | 论文账本表行 → `paper:*`；`FROM --kind--> TO` 图关系；roadmap 节点 | 可选目录 |

## 图关系机读语法（ADR / BUG 共用）

```markdown
## 图关系

- **defines** → `finding:knack-schema-v1` · Knack Schema v1
- **consumed-by** → `phase:P1` · P1 供给管道
- **defines** → `phase:P2` · 召回排序去 recency 偏置
- **motivates** → `phase:P0` · …
```

| token | 边 kind | from → to |
|---|---|---|
| `defines` | `produces` (label=`defines`) | 当前 ADR/BUG → 对端 |
| `consumed-by` | `produces` (label=`consumed-by`) + `requires` (label=`consumes`) | 上一 `defines` 目标 → 对端；对端 `requires` 目标 |
| `requires` / `produces` / `exposes` / `motivates` / `tombstones` / `verifies` | 同名 | 当前节点 → 对端 |

### ADR-004 / 005 / 006 约定示例

- ADR-004：`defines` knack schema，`consumed-by` P1 供给管道
- ADR-005：`defines` → `phase:P2`
- ADR-006：`defines` → `phase:P3`

## 边覆盖（edgeCoverage）

- 对每个 `adr` / `bug` / `phase` 统计度数（入+出）。
- `edgeCoverage.unconnected`：零边节点清单。
- **禁止静默不渲染**：dashboard 关系图必须有「未连接」分区展示零边节点，逼文档补边。
- 验收期望：全部 ADR（含非编号评审）可见且各 ≥1 边；未连接分区为空。

构建：`npm run chronicle:build` → `docs/chronicle-graph.json` + `docs/dashboard.html`。

确定性：同输入双次构建 JSON 字节相同（单测 + 脚本自检）。
