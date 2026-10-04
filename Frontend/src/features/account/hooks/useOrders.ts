import { useState, useEffect, useCallback } from "react";
import { Order } from "../types/order.types";
import { orderService } from "../api/order.api";

export const useOrders = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setOrders(await orderService.getMyOrders());
    } catch (err) {
      console.error("Failed to load orders", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  return { orders, loading, refresh: fetchOrders };
};
