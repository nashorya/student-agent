请在 task 模式下完成以下数学库扩展任务：

现有 `src/math.ts` 包含 `add` 和 `subtract` 两个函数，
`src/main.ts` 只调用了 `add`。

你需要：
1. 给 `src/math.ts` 添加 `multiply` 函数
2. 给 `src/math.ts` 添加 `divide` 函数
3. 更新 `src/main.ts`，调用所有四个函数并 console.log 输出结果
4. 确认输出结果正确

`src/main.ts` 必须使用固定操作数：

```ts
const a = 10;
const b = 5;
```

并且必须输出以下四行固定格式：

```text
10 + 5 = 15
10 - 5 = 5
10 * 5 = 50
10 / 5 = 2
```

请先规划阶段再执行，每完成一个阶段输出 PHASE_DONE 信号。
