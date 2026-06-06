export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
}

export interface Coupon {
  code: string;
  type: "percentage" | "fixed";
  value: number; // percentage: 0-100, fixed: amount in ¥
  minAmount: number; // minimum subtotal to apply
}
