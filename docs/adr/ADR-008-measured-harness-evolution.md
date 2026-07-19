# ADR-008 · 项目定位:Measured Harness Evolution

状态:已采纳(2026-07-19)

## 结论

student-agent 是一只以 harness 层自我改进为目标的 coding agent。
对标 Hermes Agent(Nous Research):同类——权重不动,靠 harness
(记忆、蒸馏、召回、skill)实现成长。差异一句话:Hermes 出货学习
回路,student-agent 要求学习回路的每一环出示因果证据后才上机。
Hermes 说 "grows with you",student-agent 说 "learns, and can
prove it"——学徒和大师的区别不是知识量,是敢不敢把自己的每一课
摊开来验。

不对标 Claude Code / Codex:那是日常工具打磨赛道,solo 不参赛
(与 ADR-001 一致;ADR-001 的"测量平台"表述自本 ADR 起澄清为
阶段手段而非项目身份——eval 是代谢的体检仪,不是产品)。

## 路线含义

1. 机制生命周期:化验(病/料是否存在)→ 受控实验 → 证据入档 →
   合入 harness。已按此上机:约束注入(BUG-011)、lesson 供给
   管道(P0→P1)、缓存前缀(C-2)。
2. First repair(可判定里程碑,非终点):某天一张任务单直接发给
   student-agent 而非工作 agent,它带着主库 lesson 完成实现并
   通过验收——该日期记入本 ADR。此后进入常态学徒期:每件活产生
   新 lesson,每条 lesson 接受同一套准入与验证。没有毕业;
   slogan 即章程:A true master is an eternal student。
3. 工具产品化(chronicle P3/P4、多项目 workspace)排序于注入
   效果实验之后:先证明代谢有效,再扩张代谢的地盘。

## 图关系
ADR-008 --clarifies--> ADR-001
ADR-008 --motivates--> finding:injection-effect-experiment
ADR-008 --defers--> chronicle:P3
ADR-008 --defers--> chronicle:P4

## scope
定位声明,不引入代码改动;对既有 ADR 无否决,仅澄清 ADR-001 措辞。
