/**
 * Shopping Cart System
 * =====================
 * 一个类型安全、功能完整的购物车系统。
 *
 * 核心能力：
 * - 商品目录管理与搜索
 * - 购物车增删改查，自动规格识别（SKU）
 * - 多重价格计算：小计、折扣、运费、优惠券
 * - 优惠券管理（满减 / 折扣 / 免邮）
 * - 事件审计日志
 */

export { ShoppingCart } from "./cart.js";
export { ProductCatalog, defaultProducts } from "./product.js";
export { CouponManager, defaultCoupons, generateCouponCode, createCouponBatch } from "./discount.js";

export type {
  Product,
  ProductCategory,
  ProductSpec,
  CartItem,
  CartSnapshot,
  CartState,
  CartEvent,
  CartEventType,
  Coupon,
  CouponType,
  ShippingRule,
} from "./types.js";
