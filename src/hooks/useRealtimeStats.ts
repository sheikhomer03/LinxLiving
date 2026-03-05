import { useState, useEffect, useCallback } from "react";

interface DashboardStats {
  totalSales: number;
  totalOrders: number;
  totalCustomers: number;
  totalProducts: number;
  totalSubscribers: number;
  totalPendingQueries: number;
}

export function useRealtimeStats(pollingInterval = 10000) {
  const [stats, setStats] = useState<DashboardStats>({
    totalSales: 0,
    totalOrders: 0,
    totalCustomers: 0,
    totalProducts: 0,
    totalSubscribers: 0,
    totalPendingQueries: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/stats");
      const data = await response.json();

      if (response.ok) {
        setStats(data.stats);
        setError(null);
      } else {
        setError(data.error || "Failed to fetch stats");
      }
    } catch (err) {
      setError("An unexpected error occurred");
      console.error("Fetch Stats Error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();

    if (pollingInterval > 0) {
      const interval = setInterval(fetchStats, pollingInterval);
      return () => clearInterval(interval);
    }
  }, [fetchStats, pollingInterval]);

  return { stats, loading, error, refresh: fetchStats };
}
