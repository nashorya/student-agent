请在 task 模式下完成以下购物车功能开发任务：

现有以下文件：
- `src/types.ts` — 定义了 `Product`（id/name/price）和 `CartItem`（productId/quantity）类型
- `src/products.ts` — 包含苹果(¥5)、香蕉(¥3)、樱桃(¥15) 三种商品数据
- `src/cart.ts` — 包含三个空函数占位：`addItem`、`removeItem`、`getTotal`，均未实现
- `src/main.ts` — 主入口，已写好调用流程但依赖未实现的函数

你需要按以下阶段完成实现（每完成一个阶段输出 PHASE_DONE 信号）：

**Phase 1：实现 addItem**
在 `src/cart.ts` 中实现 `addItem` 函数。接受当前购物车数组、商品 ID 和数量。如果购物车中已有同款商品（productId 相同），叠加其数量；否则新增一条 CartItem。返回新的购物车数组（不可变更新，不修改原数组）。

**Phase 2：实现 removeItem**
在 `src/cart.ts` 中实现 `removeItem` 函数。接受当前购物车数组、商品 ID 和要移除的数量。如果 `quantity` 大于等于购物车中该商品的数量，则移除整个条目；否则减少对应数量。返回新的购物车数组（不可变更新）。

**Phase 3：实现 getTotal**
在 `src/cart.ts` 中实现 `getTotal` 函数。接受购物车数组和商品列表，对每个 CartItem 查找对应 Product 的单价 × 数量，累加后乘以 1.08（固定 8% 增值税）。返回计算结果（Number 类型）。

**Phase 4：在 main.ts 中调用并验证输出**
确认 `src/main.ts` 已调用所有三个函数（addItem / removeItem / getTotal），运行 `npx tsx src/main.ts` 验证输出正确。

请先规划阶段再执行，每完成一个阶段输出 PHASE_DONE 信号。
