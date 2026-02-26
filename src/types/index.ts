export interface User {
  id: string;
  name: string;
  email: string;
  image?: string;
  role: "user" | "admin";
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  images: string[];
  category: string;
  stock: number;
  specs?: {
    material?: string;
    finish?: string;
    size?: string;
    slipRating?: string;
    variation?: string;
    suitability?: string;
    rectifiedEdge?: string;
    thickness?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CartItem extends Product {
  quantity: number;
}

export interface Order {
  id: string;
  userId: string;
  items: CartItem[];
  total: number;
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled";
  shippingAddress: string;
  createdAt: string;
}

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
};
