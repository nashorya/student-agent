请在 task 模式下完成以下新版购物车功能开发任务：

现有以下文件：
- `src/types.ts` — 定义了 `Product`（id/name/price/category）、`CartItem`（productId/quantity）和 `Coupon`（code/type/value/minAmount）类型
- `src/products.ts` — 包含 5 种商品（苹果¥5、香蕉¥3、樱桃¥15、牛奶¥12、面包¥8），带 category 分类
- `src/cart.ts` — 包含四个空函数占位：`addItem`、`removeItem`、`getSubtotal`、`checkout`，均未实现
- `src/main.ts` — 主入口，已写好调用流程但依赖未实现的函数

你需要按以下阶段完成实现（每完成一个阶段输出 PHASE_DONE 信号）：

**Phase 1：实现 addItem 和 removeItem**
在 `src/cart.ts` 中实现 `addItem` 和 `removeItem`。规则与旧版一致：addItem 查找同款叠加数量，removeItem 支持部分移除和整条移除，均不可变更新。

**Phase 2：实现 getSubtotal**
在 `src/cart.ts` 中实现 `getSubtotal`。遍历购物车，对每个 CartItem 从 products 中查找对应 Product，累加 price × quantity。如果商品 ID 找不到，跳过该项。

**Phase 3：实现 checkout**
在 `src/cart.ts` 中实现 `checkout`。需要完成：
1. 调用 getSubtotal 获得小计
2. 如果传入了 coupon 且小计 >= coupon.minAmount，则应用优惠：
   - percentage 类型：折后价 = subtotal × (1 - value / 100)
   - fixed 类型：折后价 = subtotal - value（不低于 0）
   - 不满足 minAmount 时优惠券不生效，用原价
3. 在折后价上附加 8% 增值税
4. 返回 Math.round(result × 100) / 100（保留两位小数）

**Phase 4：运行并验证输出**
确保 `src/main.ts` 能正确调用所有函数，运行 `npx tsx src/main.ts` 验证输出正确。

请先规划阶段再执行，每完成一个阶段输出 PHASE_DONE 信号。
