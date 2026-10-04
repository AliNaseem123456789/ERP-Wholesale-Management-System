import { useState, useEffect, useCallback } from "react";
import { SubAccount } from "../types/team.types";
import { teamService } from "../api/team.api";

export const useTeam = () => {
  const [team, setTeam] = useState<SubAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const getTeam = useCallback(async () => {
    try {
      setLoading(true);
      const data = await teamService.fetchTeam();
      setTeam(data);
    } catch (err) {
      console.error("Team fetch error", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getTeam();
  }, [getTeam]);

  const toggleAccess = async (id: string, currentStatus: boolean) => {
    try {
      setTeam((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, permissions: { can_place_order: !currentStatus } }
            : m,
        ),
      );
      await teamService.togglePermission(id, !currentStatus);
    } catch (err) {
      alert("Permission update failed");
      getTeam();
    }
  };

  return { team, loading, toggleAccess, refresh: getTeam };
};
