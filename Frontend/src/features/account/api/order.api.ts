import { apiClient } from "../../../api/apiClient";
import { Order } from "../types/order.types";

export const orderService = {
  getMyOrders: async (): Promise<Order[]> => {
    const { data } = await apiClient.get("/orders/my-orders");
    return data.data;
  },
};
