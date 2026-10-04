import { apiClient } from "../../../api/apiClient";
import { TeamResponse, SubAccount } from "../types/team.types";

export const teamService = {
  fetchTeam: async (): Promise<SubAccount[]> => {
    const { data } = await apiClient.get<TeamResponse>(
      "/account/my-sub-accounts"
    );
    return data.data;
  },

  togglePermission: async (
    subAccountId: string,
    canPlaceOrder: boolean
  ): Promise<void> => {
    await apiClient.patch("/account/update-subaccount-permission", {
      subAccountId,
      canPlaceOrder,
    });
  },

  addMember: async (formData: any): Promise<void> => {
    await apiClient.post("/account/add-subaccount", formData);
  },
};
