# 蒸馏盲区登记

**finding:蒸馏判据对"一次做对"轨迹恒返 null**

现象:findCausalPair 仅认「error → operation → verification」因果对;
轨迹若无 tool_error(一杆进洞),即使 resolved=true 也确定性返 null。
证据:sympy-v4-rematch 批 A-L 题3(24213),resolved=1、11 轮、
0 阶梯触发、0 tool_error,蒸馏为空。

**连锁后果(需正视)**:agent 能力越强、犯错越少,蒸馏产量越低——
与项目目标反向咬合。当前主库三条 verified 全部来自"踩坑再爬出"
的轨迹,存在系统性选择偏差:库里只有"错过的教训",没有"做对的解法"。

**候选处置(待讨论,本单不动手)**:
1. 为 resolved 且无 error 的轨迹开第二萃取路径:从最终 diff +
   issue 描述生成 symptom/fix,confidence 一律 candidate,
   须经 harness reward 晋升;
2. 维持现状,接受"只学错误"的定位,并在 ADR 中明示该边界;
3. 引入批量蒸馏(Trace2Skill-2603.25158)后一并解决。

决策权在作者;在决策前,任何批次的"蒸馏产量"数字须附此边界说明。

## 图关系

```text
finding:distill-blind-spot --evidenced_by--> run:sympy-v4-rematch-24213
finding:distill-blind-spot --candidate_fix--> paper:Trace2Skill
```
