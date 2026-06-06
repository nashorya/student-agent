import { type CartItem, type Coupon, type Product } from "./types.js";

/**
 * 将指定商品添加到购物车。
 * 如果购物车中已有同款商品，叠加数量。
 * 返回新的购物车数组（不可变更新）。
 */
export function addItem(
  cart: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  // TODO: 实现
  return cart;
}

/**
 * 从购物车中移除指定商品。
 * 如果 quantity 大于等于购物车中该商品的数量，则移除整个条目；
 * 否则减少对应数量。
 * 返回新的购物车数组（不可变更新）。
 */
export function removeItem(
  cart: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  // TODO: 实现
  return cart;
}

/**
 * 计算购物车小计（不含折扣和税）。
 * 对每个 CartItem，查找对应 Product 的单价 × 数量，累加后返回。
 * 如果商品 ID 在 products 中找不到，跳过该项。
 */
export function getSubtotal(
  cart: CartItem[],
  products: Product[],
): number {
  // TODO: 实现
  return 0;
}

/**
 * 应用优惠券并计算最终总价。
 * 1. 先调用 getSubtotal 计算小计
 * 2. 检查小计是否 >= coupon.minAmount，否则优惠券不生效
 * 3. percentage 类型：总价 = subtotal * (1 - value / 100)
 *    fixed 类型：总价 = subtotal - value（不低于 0）
 * 4. 在折扣后的价格上附加 8% 增值税
 * 5. 最终结果保留两位小数（Math.round(x * 100) / 100）
 */
export function checkout(
  cart: CartItem[],
  products: Product[],
  coupon?: Coupon,
): number {
  // TODO: 实现
  return 0;
}
