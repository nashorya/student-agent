import { type CartItem, type Product } from "./types.js";

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
 * 计算购物车总价（含税）。
 * 税率固定为 8%（增值税）。
 * 对每个 CartItem，查找对应 Product 的单价 × 数量，累加后乘以 (1 + taxRate)。
 */
export function getTotal(
  cart: CartItem[],
  products: Product[],
): number {
  // TODO: 实现
  return 0;
}
