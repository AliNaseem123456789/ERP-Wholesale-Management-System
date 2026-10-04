import type { User } from "../../auth/types/auth.types";

export interface ProfileUpdateFormData {
  firstName: string;
  lastName: string;
  businessName: string;
  phone: string;
}

export interface UserProfileResponse {
  message: string;
  user: User;
}
