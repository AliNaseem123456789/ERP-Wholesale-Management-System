import { apiClient } from "../../../api/apiClient";

export const fetchCreditHistory = async () => {
  const response = await apiClient.get("/account/my-history");
  return response.data;
};
