import { useState } from "react";
import { useAuth } from "../../auth/context/AuthContext";

import { accountService } from "../api/account.api.ts";
import { ProfileUpdateFormData } from "../types/account.types";

export const useUpdateProfile = () => {
  const { user, setUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = async (formData: ProfileUpdateFormData) => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const data = await accountService.updateProfile(formData);

      if (data.user) {
        setUser(data.user);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  return { update, loading, success, error, user };
};
