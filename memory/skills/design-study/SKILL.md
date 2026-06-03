# Design Study Skill — 网页视觉风格学习

> 内置宿主命令，不是模型工具列表里的普通 tool。

## 工作流

1. **学习**：`/design study <url> [--name <名字>]` → 采集首屏/移动端截图、computed style、颜色、字体、边框、圆角、阴影和组件模式 → 生成 DesignCandidate 写入 `memory/design-candidates.json`
2. **确认**：`/design confirm <candidate-id>` → 确认为 StyleProfile（永久存储）
3. **激活**：`/design use <profile-id>` → 设为 active profile，后续 Agent 任务自动遵守
4. **全局化**：`/design globalize <profile-id>` → 跨项目复用
5. **验证**：先 `/design local-url <url>`，再 `/design critique [url] [profile-id]`

## 重要规则

- 不回答"我没有访问网页/截图/DOM 的能力"——这是宿主内置能力
- `/design study` 不经过 Playwright 内容读取白名单
- 风格/审美描述超时时，候选仍然有效，可用 `/design describe <candidate-id> [--timeout 秒]` 重试
- 学习的是可迁移的视觉规则，不是网页正文内容
