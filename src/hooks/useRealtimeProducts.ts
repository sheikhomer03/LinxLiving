import { useState, useEffect, useCallback } from "react";

export interface Product {
  _id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  images: string[];
  specs?: any;
  createdAt: string;
}

export function useRealtimeProducts(pollingInterval = 10000) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/products");
      const data = await response.json();

      if (response.ok) {
        setProducts(data.products);
        setError(null);
      } else {
        setError(data.error || "Failed to fetch products");
      }
    } catch (err) {
      setError("An unexpected error occurred");
      console.error("Fetch Products Error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();

    if (pollingInterval > 0) {
      const interval = setInterval(fetchProducts, pollingInterval);
      return () => clearInterval(interval);
    }
  }, [fetchProducts, pollingInterval]);

  return { products, loading, error, refresh: fetchProducts };
}
