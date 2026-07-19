# Chronicle Graph 解析契约

权威实现与契约注释：`src/archive/knowledge-graph.ts` 文件头。

| 源 | 规则摘要 | 失败策略 |
|---|---|---|
| `docs/buglog.md` | `## BUG-NNN · title` + `**状态**` / `**症状**` | 缺状态 → parseErrors(path+line) |
| `docs/adr/ADR-*.md` | `# ADR-NNN`、状态行、`### Pn ·`、Tombstone 表 | 缺 ADR 编号标题 → parseErrors |
| `docs/adr/*jspace*` | 非编号 ADR 仍可产 `finding:jspace-external` 墓碑 | 同时 report 缺编号 |
| `docs/INDEX.md` | 纵向时间轴三列表 | 坏行列 → parseErrors |
| `evals/distillation/*` | 文件节点 + vitals JSON 字段 | 可选目录 |

构建：`npm run chronicle:build` → `docs/chronicle-graph.json` + `docs/dashboard.html`。

确定性：同输入双次构建 JSON 字节相同（单测 + 脚本自检）。
