export interface Product {
  id: string;
  name: string;
  price: number;
}

export interface CartItem {
  productId: string;
  quantity: number;
}
