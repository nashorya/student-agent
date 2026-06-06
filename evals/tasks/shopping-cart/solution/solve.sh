#!/usr/bin/env bash
set -euo pipefail

cd "$SANDBOX_DIR"

# Phase 1: 实现 addItem 和 removeItem（getSubtotal 和 checkout 保持占位）
cat > src/cart.ts << 'CART'
import { type CartItem, type Coupon, type Product } from "./types.js";

export function addItem(
  cart: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  const index = cart.findIndex((item) => item.productId === productId);
  if (index === -1) {
    return [...cart, { productId, quantity }];
  }
  const updated = [...cart];
  updated[index] = { ...updated[index], quantity: updated[index].quantity + quantity };
  return updated;
}

export function removeItem(
  cart: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  return cart.reduce<CartItem[]>((acc, item) => {
    if (item.productId === productId) {
      const remain = item.quantity - quantity;
      if (remain > 0) {
        acc.push({ ...item, quantity: remain });
      }
    } else {
      acc.push(item);
    }
    return acc;
  }, []);
}

export function getSubtotal(
  cart: CartItem[],
  products: Product[],
): number {
  // TODO: 实现
  return 0;
}

export function checkout(
  cart: CartItem[],
  products: Product[],
  coupon?: Coupon,
): number {
  // TODO: 实现
  return 0;
}
CART

# Phase 2: 实现 getSubtotal（checkout 保持占位）
cat > src/cart.ts << 'CART'
import { type CartItem, type Coupon, type Product } from "./types.js";

export function addItem(
  cart: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  const index = cart.findIndex((item) => item.productId === productId);
  if (index === -1) {
    return [...cart, { productId, quantity }];
  }
  const updated = [...cart];
  updated[index] = { ...updated[index], quantity: updated[index].quantity + quantity };
  return updated;
}

export function removeItem(
  cart: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  return cart.reduce<CartItem[]>((acc, item) => {
    if (item.productId === productId) {
      const remain = item.quantity - quantity;
      if (remain > 0) {
        acc.push({ ...item, quantity: remain });
      }
    } else {
      acc.push(item);
    }
    return acc;
  }, []);
}

export function getSubtotal(
  cart: CartItem[],
  products: Product[],
): number {
  return cart.reduce<number>((sum, item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return sum;
    return sum + product.price * item.quantity;
  }, 0);
}

export function checkout(
  cart: CartItem[],
  products: Product[],
  coupon?: Coupon,
): number {
  // TODO: 实现
  return 0;
}
CART

# Phase 3: 实现 checkout
cat > src/cart.ts << 'CART'
import { type CartItem, type Coupon, type Product } from "./types.js";

export function addItem(
  cart: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  const index = cart.findIndex((item) => item.productId === productId);
  if (index === -1) {
    return [...cart, { productId, quantity }];
  }
  const updated = [...cart];
  updated[index] = { ...updated[index], quantity: updated[index].quantity + quantity };
  return updated;
}

export function removeItem(
  cart: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  return cart.reduce<CartItem[]>((acc, item) => {
    if (item.productId === productId) {
      const remain = item.quantity - quantity;
      if (remain > 0) {
        acc.push({ ...item, quantity: remain });
      }
    } else {
      acc.push(item);
    }
    return acc;
  }, []);
}

export function getSubtotal(
  cart: CartItem[],
  products: Product[],
): number {
  return cart.reduce<number>((sum, item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return sum;
    return sum + product.price * item.quantity;
  }, 0);
}

export function checkout(
  cart: CartItem[],
  products: Product[],
  coupon?: Coupon,
): number {
  const subtotal = getSubtotal(cart, products);
  let discounted = subtotal;

  if (coupon && subtotal >= coupon.minAmount) {
    if (coupon.type === "percentage") {
      discounted = subtotal * (1 - coupon.value / 100);
    } else if (coupon.type === "fixed") {
      discounted = Math.max(0, subtotal - coupon.value);
    }
  }

  const total = discounted * 1.08;
  return Math.round(total * 100) / 100;
}
CART

# Phase 4: main.ts 已预设好调用逻辑，无需修改
echo "Solution complete: cart.ts has addItem, removeItem, getSubtotal, checkout implemented"