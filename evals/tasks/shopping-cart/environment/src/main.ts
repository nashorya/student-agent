import { addItem, removeItem, getTotal } from "./cart.js";
import { products } from "./products.js";
import type { CartItem } from "./types.js";

// 初始购物车为空
let cart: CartItem[] = [];

// 添加商品
cart = addItem(cart, "apple", 2);
cart = addItem(cart, "banana", 3);
cart = addItem(cart, "cherry", 1);

// 移除部分商品
cart = removeItem(cart, "banana", 1);

// 计算总价（含 8% 税）
const total = getTotal(cart, products);

console.log(`购物车中有 ${cart.length} 种商品`);
console.log(`总价（含税）: ¥${total}`);
