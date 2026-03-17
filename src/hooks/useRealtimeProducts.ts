import { useState, useEffect, useCallback } from "react";

export interface Product {
  _id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  subCategory?: string;
  images: string[];
  specs?: any;
  createdAt: string;
}

export function useRealtimeProducts(page = 1, limit = 50, pollingInterval = 10000) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const fetchProducts = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/products?page=${page}&limit=${limit}`);
      const data = await response.json();

      if (response.ok) {
        setProducts(data.products);
        setTotalCount(data.pagination.total);
        setTotalPages(data.pagination.pages);
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
  }, [page, limit]);

  useEffect(() => {
    fetchProducts();

    if (pollingInterval > 0) {
      const interval = setInterval(fetchProducts, pollingInterval);
      return () => clearInterval(interval);
    }
  }, [fetchProducts, pollingInterval]);

  return { products, totalCount, totalPages, loading, error, refresh: fetchProducts };
}
