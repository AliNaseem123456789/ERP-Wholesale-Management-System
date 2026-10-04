import { apiClient } from "../../../api/apiClient";

export async function getPaymentHistory() {
  const { data } = await apiClient.get("/orders/payment-history");
  return data.data || [];
}
