import { addItem, removeItem, getSubtotal, checkout } from "./cart.js";
import { products } from "./products.js";
import type { CartItem, Coupon } from "./types.js";

// 初始购物车为空
let cart: CartItem[] = [];

// Phase 1-2：添加和移除商品
cart = addItem(cart, "apple", 3);
cart = addItem(cart, "milk", 2);
cart = addItem(cart, "bread", 1);
cart = removeItem(cart, "apple", 1);

const subtotal = getSubtotal(cart, products);
console.log(`购物车中有 ${cart.length} 种商品`);
console.log(`小计: ¥${subtotal}`);

// Phase 3：使用优惠券结账
const coupon: Coupon = {
  code: "WELCOME10",
  type: "percentage",
  value: 10,
  minAmount: 10,
};
const total = checkout(cart, products, coupon);
console.log(`总价（含 8% 税，已应用优惠券）: ¥${total}`);
