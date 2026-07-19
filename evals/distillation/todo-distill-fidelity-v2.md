# TODO · 蒸馏表述保真度 v2（占位，不执行）

- **登记**：2026-07-19
- **触发**：P1-E 盲审 2/3；#1 判 0（`Symptom: confirmed.` 诊断口水话，检索钥匙失效）
- **范围**（仅登记）：
  1. `extractSymptom` 抓取对象：agent 诊断独白 → **任务侧错误表象**（issue 标题 / 首个报错行）
  2. `extractFixSummary` 截断：**按句取整**，避免半句脏截断
- **边界**：不改蒸馏因果门控 / 不改 LessonWriter 准入
- **状态**：OPEN；与 Chronicle Dashboard 并列，作者选序后动手
