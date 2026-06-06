/** 商品分类 */
export type ProductCategory =
  | "电子产品"
  | "服装"
  | "食品"
  | "图书"
  | "家居"
  | "美妆"
  | "运动"
  | "其他";

/** 商品规格选项 */
export interface ProductSpec {
  name: string;       // 如 "颜色", "尺寸"
  values: string[];   // 如 ["红色", "蓝色"], ["S", "M", "L"]
}

/** 商品 */
export interface Product {
  id: string;
  name: string;
  price: number;            // 原价（分）
  discountPrice?: number;   // 折扣价（分），可选
  category: ProductCategory;
  description: string;
  imageUrl?: string;
  stock: number;
  specs?: ProductSpec[];    // 规格定义
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** 购物车单个商品项（含规格选择） */
export interface CartItem {
  skuId: string;            // 唯一标识（productId + 规格组合）
  productId: string;
  name: string;
  price: number;            // 当前实际单价（分）
  quantity: number;
  specs: Record<string, string>;  // {"颜色": "红色", "尺寸": "M"}
  imageUrl?: string;
  maxQuantity: number;      // 库存上限
}

/** 优惠券类型 */
export type CouponType = "满减" | "折扣" | "免邮";

/** 优惠券 */
export interface Coupon {
  id: string;
  code: string;
  type: CouponType;
  /** 满减：满多少金额（分） */
  threshold?: number;
  /** 满减：减多少金额（分）/ 折扣：0-100 百分比 */
  value: number;
  description: string;
  validFrom: Date;
  validTo: Date;
  minSpend?: number;        // 最低消费（分）
  applicableCategories?: ProductCategory[];
  usedAt?: Date;
}

/** 运费策略 */
export interface ShippingRule {
  baseFee: number;          // 基础运费（分）
  freeThreshold: number;    // 满多少免运费（分）
  additionalPerItem?: number; // 每增加一件加收（分）
}

/** 购物车快照（用于计算） */
export interface CartSnapshot {
  items: CartItem[];
  subtotal: number;         // 商品原价小计
  discount: number;         // 商品折扣节省
  shipping: number;         // 运费
  couponDiscount: number;   // 优惠券减免
  couponApplied: boolean;
  total: number;            // 最终应付
  itemCount: number;        // 商品件数
  uniqueItemCount: number;  // 商品种类数
}

/** 购物车事件 */
export type CartEventType =
  | "ITEM_ADDED"
  | "ITEM_REMOVED"
  | "QUANTITY_CHANGED"
  | "SPEC_CHANGED"
  | "CLEARED"
  | "COUPON_APPLIED"
  | "COUPON_REMOVED";

export interface CartEvent {
  type: CartEventType;
  timestamp: Date;
  skuId?: string;
  productId?: string;
  detail?: string;
}

/** 购物车整体状态 */
export interface CartState {
  items: CartItem[];
  coupon: Coupon | null;
  shippingRule: ShippingRule;
  history: CartEvent[];
  updatedAt: Date;
}
