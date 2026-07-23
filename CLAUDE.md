# CLAUDE.md — student-agent 工作约定

本文件供 Claude / Cursor 等 agent 在本仓库内遵守的查阅与落痕规则。
细节架构仍以 `docs/` 与 ADR 为准。

## 参考资料查阅

仓库已归档论文快照于 `docs/roadmap/papers/`（Markdown；索引见同目录 `MANIFEST.csv`）。

### 触发场景

仅当任务属于涉及以下主题的**设计决策**时查阅：

- 记忆管线
- 蒸馏
- 召回
- skill / knack 机制
- 失败升级

### 查阅顺序（写死）

1. **先读** `docs/roadmap/papers/MANIFEST.csv`，用 `keywords` / `applies_to` / 缩写定位条目；
2. **再读** 对应 `docs/roadmap/papers/<arXiv-id>.md` 的相关章节；
3. **禁止**对 `docs/roadmap/papers/` 全目录盲目 `grep` / 通读。

### 不触发

以下任务类型**不要**为「找灵感」去翻 papers/：

- 纯实现
- 修 bug
- 跑 eval
- 文书整理

### 落痕要求

据某篇论文做出的设计选择，须在任务报告或 commit message 注明来源，格式：

`per <缩写>-<arXiv号>`

例：`per SPARK/PDI-2605.09192`、`per ExpeL-2308.10144`。
