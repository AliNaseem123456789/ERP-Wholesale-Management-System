import { apiClient } from "../../../api/apiClient";
import {
  ProfileUpdateFormData,
  UserProfileResponse,
} from "../types/account.types";

export const accountService = {
  updateProfile: async (
    formData: ProfileUpdateFormData
  ): Promise<UserProfileResponse> => {
    const { data } = await apiClient.patch<UserProfileResponse>(
      "/account/update-profile",
      formData
    );
    return data;
  },
};
