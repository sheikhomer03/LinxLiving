import { useState, useEffect, useCallback } from "react";

interface OrderItem {
  product: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
}

export interface Order {
  _id: string;
  orderNumber: string;
  totalAmount: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  createdAt: string;
  items: OrderItem[];
  shippingAddress: any;
}

export function useRealtimeOrders(pollingInterval = 10000) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const response = await fetch("/api/orders");
      const data = await response.json();

      if (response.ok) {
        setOrders(data.orders);
        setError(null);
      } else {
        setError(data.error || "Failed to fetch orders");
      }
    } catch (err) {
      setError("An unexpected error occurred");
      console.error("Fetch Orders Error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();

    if (pollingInterval > 0) {
      const interval = setInterval(fetchOrders, pollingInterval);
      return () => clearInterval(interval);
    }
  }, [fetchOrders, pollingInterval]);

  return { orders, loading, error, refresh: fetchOrders };
}

export function useSingleOrder(orderId: string, pollingInterval = 10000) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrder = useCallback(async () => {
    if (!orderId) return;
    try {
      const response = await fetch(`/api/orders/${orderId}`);
      const data = await response.json();

      if (response.ok) {
        setOrder(data.order);
        setError(null);
      } else {
        setError(data.error || "Failed to fetch order");
      }
    } catch (err) {
      setError("An unexpected error occurred");
      console.error("Fetch Order Error:", err);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    fetchOrder();

    if (pollingInterval > 0) {
      const interval = setInterval(fetchOrder, pollingInterval);
      return () => clearInterval(interval);
    }
  }, [fetchOrder, pollingInterval]);

  return { order, loading, error, refresh: fetchOrder };
}
